import {Server as HTTPServer} from 'http';
import createHTTPServer from './util/http_server';
import {equal as assertEqual} from 'assert';
import {SourceFile} from '../src/common/interfaces';
import ChromeRemoteDebuggingDriver from '../src/webdriver/chrome_remote_debugging_driver';

const HTTP_PORT = 8888;

interface TestFile {
  mimeType: string;
  data: Buffer;
}

// 'Files' present in the test HTTP server
const FILES: {[name: string]: TestFile} = {
  '/test.html': {
    mimeType: 'text/html',
    data: Buffer.from('<!DOCTYPE html><html><head><title>My Web Page</title></head></html>', 'utf8')
  },
  '/test.js': {
    mimeType: 'text/javascript',
    data: Buffer.from('window.SHENANIGANS = true;', 'utf8')
  },
  '/test.jpg': {
    mimeType: 'image/jpeg',
    data: Buffer.alloc(1025, 0)
  },
  '/huge.html': {
    mimeType: 'text/html',
    // 10MB file filled w/ a's.
    data: Buffer.alloc(1024*1024*10, 97)
  },
  '/huge.jpg': {
    mimeType: 'image/jpeg',
    data: Buffer.alloc(1024*1024*10, 0)
  },
  '/': {
    mimeType: 'text/html',
    data: Buffer.from('<!DOCTYPE html><html><title>Not Found</title></html>', 'utf8')
  }
};

describe('Proxy', function() {
  this.timeout(30000);
  let proxy: ChromeRemoteDebuggingDriver;
  let httpServer: HTTPServer;
  before(async function() {
    httpServer = await createHTTPServer(FILES, HTTP_PORT);
    proxy = await ChromeRemoteDebuggingDriver.Launch(<any> process.stdout);
  });

  async function requestFile(path: string, expected: Buffer): Promise<void> {
    const response = await proxy.httpGet(`http://localhost:${HTTP_PORT}${path}`);
    assertEqual(response.data.equals(expected), true);
  }

  it("Properly proxies text files", function(done) {
    function nop(f: SourceFile): SourceFile {
      return f;
    }
    proxy.onRequest(nop);
    const promises = ['/test.html', '/test.js'].map((filename) => {
      return requestFile(filename, FILES[filename].data);
    });
    promises.push(requestFile('/test.jpg', FILES['/test.jpg'].data));
    Promise.all(promises).then(() => done()).catch(done);
  });

  it("Properly rewrites text files", function(done) {
    const MAGIC_STRING = Buffer.from("HELLO THERE", 'utf8');
    function transform(f: SourceFile): SourceFile {
      f.contents = MAGIC_STRING;
      return f;
    }
    proxy.onRequest(transform);
    const promises = ['/test.html', '/test.js'].map((filename) => {
      return requestFile(filename, MAGIC_STRING);
    });
    promises.push(requestFile('/test.jpg', FILES['/test.jpg'].data));
    Promise.all(promises).then(() => done()).catch(done);
  });

  it("Properly proxies huge binary files", function(done) {
    proxy.onRequest((f) => f);
    requestFile('/huge.jpg', FILES['/huge.jpg'].data).then(() => done()).catch(done);
  });

  it("Properly proxies huge text files", function(done) {
    const raw = FILES['/huge.html'].data;
    const expected = Buffer.alloc(raw.length, 98);
    proxy.onRequest((f) => {
      f.contents = Buffer.from(f.contents.toString().replace(/a/g, 'b'), 'utf8');
      return f;
    });
    requestFile('/huge.html', expected).then(() => done()).catch(done);
  });

  after(function(done) {
    // Shutdown both HTTP server and proxy.
    httpServer.close((e: any) => {
      if (e) {
        done(e);
      } else {
        proxy.shutdown().then(done).catch(done);
      }
    });
  });
});