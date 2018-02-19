import {Server as HTTPServer} from 'http';
import createHTTPServer from './util/http_server';
import {equal as assertEqual} from 'assert';
import {gzipSync, gunzipSync} from 'zlib';
import {default as MITMProxy, InterceptedHTTPMessage, nopInterceptor} from 'mitmproxy';

const HTTP_PORT = 8888;

interface TestFile {
  mimeType: string;
  data: Buffer;
  headers?: {[name: string]: string}
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
  '/test.js.gz': {
    mimeType: 'text/javascript',
    data: gzipSync(Buffer.from('window.SHENANIGANS = true;', 'utf8')),
    headers: {
      'content-encoding': 'gzip'
    }
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
  let proxy: MITMProxy;
  let httpServer: HTTPServer;
  before(async function() {
    httpServer = await createHTTPServer(FILES, HTTP_PORT);
    proxy = await MITMProxy.Create(undefined, [], true);
  });

  async function requestFile(path: string, expected: Buffer): Promise<void> {
    const response = await proxy.proxyGet(`http://localhost:${HTTP_PORT}${path}`);
    if (!response.body.equals(expected)) {
      console.log(`${response.body.length} actual, ${expected.length} expected`);
      console.log(`${response.body[10]}, ${expected[10]}`);
    }
    assertEqual(response.body.equals(expected), true);
  }

  it("Properly proxies text files", async function() {
    proxy.cb = nopInterceptor;
    const promises = ['/test.html', '/test.js'].map((filename) => {
      return requestFile(filename, FILES[filename].data);
    });
    promises.push(requestFile('/test.jpg', FILES['/test.jpg'].data));
    return Promise.all(promises);
  });

  it("Properly handles compressed data", async function() {
    proxy.cb = nopInterceptor;
    await requestFile('/test.js.gz', gunzipSync(FILES['/test.js.gz'].data));
  });

  it("Properly rewrites text files", async function() {
    const MAGIC_STRING = Buffer.from("HELLO THERE", 'utf8');
    function transform(m: InterceptedHTTPMessage): void {
      const mimeType = m.response.getHeader('content-type').toLowerCase();
      if (mimeType === "text/html" || mimeType === "text/javascript") {
        m.setResponseBody(MAGIC_STRING);
      }
    }
    proxy.cb = transform;
    const promises = ['/test.html', '/test.js'].map((filename) => {
      return requestFile(filename, MAGIC_STRING);
    });
    promises.push(requestFile('/test.jpg', FILES['/test.jpg'].data));
    return Promise.all(promises);
  });

  it("Properly proxies huge binary files", async function() {
    proxy.cb = nopInterceptor;
    return requestFile('/huge.jpg', FILES['/huge.jpg'].data);
  });

  it("Properly proxies huge text files", async function() {
    const raw = FILES['/huge.html'].data;
    const expected = Buffer.alloc(raw.length, 98);
    proxy.cb = (f: InterceptedHTTPMessage): void => {
      f.setResponseBody(Buffer.from(f.responseBody.toString().replace(/a/g, 'b'), 'utf8'));
    };
    return requestFile('/huge.html', expected);
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