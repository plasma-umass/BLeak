import {Server as HTTPServer} from 'http';
import ChromeDriver from '../src/webdriver/chrome_driver';
import FindLeaks from '../src/lib/deuterium_oxide';
import createHTTPServer from './util/http_server';
import Proxy from '../src/proxy/proxy';
import {readFileSync} from 'fs';
import {equal as assertEqual} from 'assert';

const HTTP_PORT = 8875;
const PROXY_PORT = 5554;
const CHROME_DRIVER_PORT = 4444;

interface TestFile {
  mimeType: string;
  data: Buffer;
}

// 'Files' present in the test HTTP server
const FILES: {[name: string]: TestFile} = {
  '/test.html': {
    mimeType: 'text/html',
    data: Buffer.from('<!DOCTYPE html><html><head><title>My Web Page</title></head><body><button id="btn">Click Me</button><script type="text/javascript" src="/test.js"></script></body></html>', 'utf8')
  },
  '/test.js': {
    mimeType: 'text/javascript',
    data: Buffer.from(`var obj = {};
    var i = 0;
    var power = 2;
    document.getElementById('btn').addEventListener('click', function() {
      var top = Math.pow(2, power);
      power++;
      for (var j = 0; j < top; j++) {
        obj[Math.random()] = Math.random();
      }
    });
    `, 'utf8')
  },
  '/deuterium_agent.js': {
    mimeType: 'text/javascript',
    data: readFileSync(require.resolve('../src/lib/deuterium_agent'))
  }
};

describe('End-to-end Tests', function() {
  // 10 minute timeout.
  this.timeout(600000);
  let proxy: Proxy;
  let httpServer: HTTPServer;
  let driver: ChromeDriver;
  before(function(done) {
    createHTTPServer(FILES, HTTP_PORT).then((server) => {
      httpServer = server;
      return Proxy.listen(PROXY_PORT);
    }).then((_proxy) => {
      proxy = _proxy;
      ChromeDriver.Launch(proxy, CHROME_DRIVER_PORT).then((_driver) => {
        driver = _driver;
        done();
      });
    }).catch(done);
  });

  it('Catches leaks', function(done) {
    FindLeaks(`
      exports.url = 'http://localhost:${HTTP_PORT}/test.html';
      exports.loop = [
        {
          name: 'Click Button',
          check: function() {
            return document.readyState === "complete";
          },
          next: function() {
            document.getElementById('btn').click();
          }
        }
      ];
      exports.timeout = 30000;
    `, proxy, driver).then((leaks) => {
      // Line 8
      leaks.forEach((leak) => {
        const newProps = leak.newProperties;
        for (const propName in newProps) {
          const stacks = newProps[propName];
          stacks.forEach((s) => {
            assertEqual(s.length > 0, true);
            const topFrame = s[0];
            console.log(topFrame.toString());
            assertEqual(topFrame.lineNumber, 8);
            assertEqual(topFrame.fileName.indexOf("test.js") !== -1, true);
          });
        }
      })
      done();
    }).catch(done);
  });

  after(function(done) {
    //setTimeout(function() {
      // Shutdown both HTTP server and proxy.
      httpServer.close((e: any) => {
        if (e) {
          done(e);
        } else {
          driver.close().then(() => {
            return proxy.shutdown().then(() => {
              done();
            });
          }).catch(done);
        }
      });
    //}, 180000);
  });
});