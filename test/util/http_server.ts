import {createServer as createHTTPServer, Server as HTTPServer, ServerResponse} from 'http';

export interface TestFile {
  mimeType: string;
  data: Buffer;
  headers?: {[name: string]: string};
}

function sendResponse(res: ServerResponse, testFile: TestFile): void {
  res.statusCode = 200;
  res.setHeader('content-type', testFile.mimeType);
  if (testFile.headers) {
    Object.keys(testFile.headers).forEach((k) => {
      res.setHeader(k, testFile.headers[k]);
    });
  }
  res.write(testFile.data);
  res.end();
}

/**
 * Creates a test HTTP server that serves up static in-memory "files".
 * @param files Map from server path to file data.
 * @param port Port to listen on for HTTP requests.
 */
export default function createSimpleServer(files: {[path: string]: TestFile}, port: number): Promise<HTTPServer> {
  return new Promise<HTTPServer>((res, rej) => {
    // Start test HTTP server + proxy.
    const httpServer = createHTTPServer(function(req, res) {
      const url = req.url.toLowerCase();
      const testFile = files[url] || files['/'];
      if (testFile) {
        sendResponse(res, testFile);
      } else {
        res.statusCode = 404;
        res.end();
      }
    });
    httpServer.listen(port, (e: any) => {
      if (e) {
        rej(e)
      } else {
        res(httpServer);
      }
    });
  });
}