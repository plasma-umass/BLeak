import {Server as HTTPServer} from 'http';
import ChromeDriver from '../src/webdriver/chrome_driver';
import FindLeaks from '../src/lib/deuterium_oxide';
import createHTTPServer from './util/http_server';
import Proxy from '../src/proxy/proxy';
import {readFileSync, writeFileSync} from 'fs';
import {equal as assertEqual} from 'assert';
// import {Leak} from '../src/common/interfaces';

const HTTP_PORT = 8875;
const PROXY_PORT = 5554;
const CHROME_DRIVER_PORT = 4444;

interface TestFile {
  mimeType: string;
  data: Buffer;
}

function getHTMLConfig(name: string): { mimeType: string, data: Buffer } {
  return {
    mimeType: 'text/html',
    data: Buffer.from(`<!DOCTYPE html><html><head><title>${name}</title></head><body><button id="btn">Click Me</button><script type="text/javascript" src="/${name}.js"></script></body></html>`, 'utf8')
  };
}

// 'Files' present in the test HTTP server
const FILES: {[name: string]: TestFile} = {
  '/test.html': getHTMLConfig('test'),
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
  '/closure_test.html': getHTMLConfig('closure_test'),
  '/closure_test.js': {
    mimeType: 'text/javascript',
    data: Buffer.from(`(function() {
      var obj = {};
      var i = 0;
      var power = 2;
      document.getElementById('btn').addEventListener('click', function() {
        var top = Math.pow(2, power);
        power++;
        for (var j = 0; j < top; j++) {
          obj[Math.random()] = Math.random();
        }
      });
    })();
    `, 'utf8')
  },
  '/reassignment_test.html': getHTMLConfig('reassignment_test'),
  '/reassignment_test.js': {
    mimeType: 'text/javascript',
    data: Buffer.from(`
    (function() {
      var obj = [];
      var i = 0;
      var power = 2;
      document.getElementById('btn').addEventListener('click', function() {
        var top = Math.pow(2, power);
        power++;
        for (var j = 0; j < top; j++) {
          obj = obj.concat({ val: Math.random() });
        }
      });
    })();
    `, 'utf8')
  },
  '/multiple_paths_test.html': getHTMLConfig('multiple_paths_test'),
  '/multiple_paths_test.js': {
    mimeType: 'text/javascript',
    data: Buffer.from(`(function() {
      var obj = {};
      var obj2 = obj;
      var i = 0;
      var power = 2;
      document.getElementById('btn').addEventListener('click', function() {
        var top = Math.pow(2, power);
        power++;
        for (var j = 0; j < top; j++) {
          if (obj === obj2) {
            var target = Math.random() > 0.5 ? obj : obj2;
            target[Math.random()] = Math.random();
          }
        }
      });
    })();
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

  function createStandardLeakTest(description: string, rootFilename: string, expected_line: number): void {
    it(description, function(done) {
      let i = 0;
      FindLeaks(`
        exports.url = 'http://localhost:${HTTP_PORT}/${rootFilename}.html';
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
      `, proxy, driver, (ss) => {
        writeFileSync(`${rootFilename}${i}.heapsnapshot`, Buffer.from(JSON.stringify(ss), 'utf8'));
        i++;
      }).then((leaks) => {
        assertEqual(leaks.length > 0, true);
        leaks.forEach((leak) => {
          const newProps = leak.newProperties;
          for (const propName in newProps) {
            const stacks = newProps[propName];
            stacks.forEach((s) => {
              assertEqual(s.length > 0, true);
              const topFrame = s[0];
              console.log(topFrame.toString());
              assertEqual(topFrame.lineNumber, expected_line);
              assertEqual(topFrame.fileName.indexOf(`${rootFilename}.js`) !== -1, true);
            });
          }
        })
        done();
      }).catch(done);
    });
  }

  createStandardLeakTest('Catches leaks', 'test', 8);
  createStandardLeakTest('Catches leaks in closures', 'closure_test', 9);
  createStandardLeakTest('Catches leaks when object is copied and reassigned', 'reassignment_test', 10);
  createStandardLeakTest('Catches leaks when object stored in multiple paths', 'multiple_paths_test', 12);

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