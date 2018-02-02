import createHTTPServer from './util/http_server';
import {Server as HTTPServer} from 'http';
//import ChromeBrowserDriver from '../src/webdriver/chrome_driver';
import ChromeDriver from '../src/lib/chrome_driver';
// import Proxy from '../src/proxy/proxy';
import {equal as assertEqual} from 'assert';

//const PROXY_HTTP_PORT = 4445;
//const PROXY_HTTPS_PORT = 4446;
const HTTP_PORT = 8889;
//const WEB_DRIVER_PORT = 4446;
// Run HTTP server.
// Load page that takes a long time to load -- blocking wait.
// Make sure it finishes loading before it runs scripts.
// Check magic values in page.

describe("Chrome Driver", function() {
  // 30 second timeout.
  this.timeout(30000);
  let httpServer: HTTPServer;
  let chromeDriver: ChromeDriver;
  before(async function() {
    httpServer = await createHTTPServer({
      "/": {
        mimeType: "text/html",
        data: Buffer.from("<!doctype html><html><div id='container'>ContainerText</div></html>", "utf8")
      }
    }, HTTP_PORT);
    chromeDriver = await ChromeDriver.Launch(<any> process.stdout, true);
  });

  it("Successfully loads a webpage", async function() {
    await chromeDriver.navigateTo(`http://localhost:${HTTP_PORT}/`);
    const str = await chromeDriver.runCode("document.getElementById('container').innerText");
    assertEqual(str, "ContainerText");
  });

  /*it("Can take a heap snapshot", async function() {
    const snapshot = await chromeDriver.takeHeapSnapshot();
    assertEqual(typeof(snapshot), "object");
    const expectedKeys = [ 'nodes',
      'trace_function_infos',
      'strings',
      'edges',
      'samples',
      'snapshot',
      'trace_tree' ].sort();
    const keys = Object.keys(snapshot).sort();
    console.log(`Sorted keys: ${keys.join(",")}`);
    console.log(`Unsorted keys: ${Object.keys(snapshot).join(",")}`)
    for (let i = 0; i < expectedKeys.length; i++) {
      assertEqual(keys[i], expectedKeys[i]);
    }
  });*/

  after(async function() {
    await Promise.all([chromeDriver.shutdown(), httpServer.close]);
  });
});