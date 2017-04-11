import {Server as HTTPServer, IncomingMessage, request as HTTPRequest} from 'http';
import createHTTPServer from './util/http_server';
import Proxy from '../src/proxy/proxy';
import {equal as assertEqual} from 'assert';

const HTTP_PORT = 8888;
const PROXY_PORT = 4443;

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
  '/': {
    mimeType: 'text/html',
    data: Buffer.from('<!DOCTYPE html><html><title>Not Found</title></html>', 'utf8')
  }
};

describe('Proxy', function() {
  let proxy: Proxy;
  let httpServer: HTTPServer;
  before(function(done) {
    createHTTPServer(FILES, HTTP_PORT).then((server) => {
      httpServer = server;
      return Proxy.listen(PROXY_PORT);
    }).then((_proxy) => {
      proxy = _proxy;
      done();
    }).catch(done);
  });

  function makeProxyRequest(url: string): Promise<IncomingMessage> {
    return new Promise<IncomingMessage>((res, rej) => {
      // https://stackoverflow.com/questions/3862813/how-can-i-use-an-http-proxy-with-node-js-http-client/5810547#5810547
      const request = HTTPRequest({
        method: 'get',
        hostname: '127.0.0.1',
        port: PROXY_PORT,
        path: `http://localhost:${HTTP_PORT}${url}`,
        headers: {
          Host: `localhost:${HTTP_PORT}`
        }
      }, res);
      request.on('error', rej);
      request.end();
    });
  }

  function requestFile(url: string, expected: Buffer): Promise<void> {
    return new Promise<void>((res, rej) => {
      makeProxyRequest(url).then((result) => {
        let data = new Buffer(0);
        result.on('data', (chunk: Buffer) => {
          data = Buffer.concat([data, chunk]);
        });
        result.on('end', () => {
          try {
            assertEqual(data.equals(expected), true);
            res();
          } catch (e) {
            rej(e);
          }
        });
      }).catch(rej);
    });
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
    const MAGIC_STRING = "HELLO THERE";
    function transform(f: SourceFile): SourceFile {
      f.contents = MAGIC_STRING;
      return f;
    }
    proxy.onRequest(transform);
    const promises = ['/test.html', '/test.js'].map((filename) => {
      return requestFile(filename, Buffer.from(MAGIC_STRING, 'utf8'));
    });
    promises.push(requestFile('/test.jpg', FILES['/test.jpg'].data));
    Promise.all(promises).then(() => done()).catch(done);
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