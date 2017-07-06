import createHTTPServer from './util/http_server';
import {Server as HTTPServer} from 'http';
import ChromeBrowserDriver from '../src/webdriver/chrome_driver';
import Proxy from '../src/proxy/proxy';
import {equal as assertEqual} from 'assert';

const PROXY_PORT = 4445;
const HTTP_PORT = 8889;
const WEB_DRIVER_PORT = 4446;
// Run HTTP server.
// Load page that takes a long time to load -- blocking wait.
// Make sure it finishes loading before it runs scripts.
// Check magic values in page.

describe("WebDriver", function() {
  // 30 second timeout.
  this.timeout(30000);
  let httpServer: HTTPServer;
  let chromeDriver: ChromeBrowserDriver;
  let proxy: Proxy;
  before(function(done) {
    createHTTPServer({
      "/": {
        mimeType: "text/html",
        data: Buffer.from("<!doctype html><html><div id='container'>ContainerText</div></html>", "utf8")
      }
    }, HTTP_PORT).then((server) => {
      httpServer = server;
      return Proxy.listen(PROXY_PORT).then((webProxy) => {
        proxy = webProxy;
        return ChromeBrowserDriver.Launch(proxy, WEB_DRIVER_PORT).then((driver) => {
          chromeDriver = driver;
          done();
        });
      });
    }).catch(done);
  });

  it("Successfully loads a webpage", function(done) {
    chromeDriver.navigateTo(`http://localhost:${HTTP_PORT}/`).then(() => {
      return chromeDriver.runCode("document.getElementById('container').innerText");
    }).then((str) => {
      assertEqual(str, "ContainerText");
      done();
    }).catch(done);
  });

  it("Can take a heap snapshot", function(done) {
    chromeDriver.takeHeapSnapshot().then((snapshot) => {
      assertEqual(typeof(snapshot), "object");
      const expectedKeys = [ 'nodes',
        'trace_function_infos',
        'strings',
        'edges',
        'samples',
        'snapshot',
        'trace_tree' ].sort();
      const keys = Object.keys(snapshot).sort();
      for (let i = 0; i < expectedKeys.length; i++) {
        assertEqual(keys[i], expectedKeys[i]);
      }
      done();
    }).catch(done);
  });

  after(function(done) {
    chromeDriver.close().then(() => {
      httpServer.close(done);
    });
  });
});