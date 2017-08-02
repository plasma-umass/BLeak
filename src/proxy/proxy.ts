import {createProxyServer} from 'http-proxy';
import {createServer as createHTTPServer, Server as HTTPServer, ServerResponse} from 'http';
import {parse as parseURL} from 'url';
import {SourceFile, IProxy, IProxyConstructor} from '../common/interfaces';

/**
 * A simple HTTP proxy that supports rewriting text requests/responses.
 */
export default class Proxy implements IProxy {
  public static listen(port: number): Promise<Proxy> {
    return new Proxy(port).listen(port);
  }

  private readonly _proxy = createProxyServer({});
  private readonly _server: HTTPServer;
  private _requestCb = (f: SourceFile) => f;
  public readonly port: number;

  protected constructor(port: number = 4443) {
    this.port = port;
    this._server = createHTTPServer((req, res) => {
      // get from path
      const dest = parseURL(req.url);
      // Disable compression for now.
      req.headers['accept-encoding'] = '';
      const write = res.write;
      function writePromise(data: Buffer): Promise<void> {
        return new Promise<void>((success, rej) => {
          write.call(res, data, (e: any) => {
            e ? rej(e) : success();
          });
        });
      }
      if (req.method.toLowerCase() === 'get') {
        const allData = new Array<Buffer>();
        const writeHead = res.writeHead;
        let writeHeadArgs: any[] = null;
        res.writeHead = function(this: ServerResponse, ...args: any[]): void {
          writeHeadArgs = args;
        };
        res.write = function(this: ServerResponse, data: Buffer| string, arg2?: string | Function, arg3?: string | Function): boolean {
          if (typeof(data) === "string") {
            allData.push(Buffer.from(data, "utf8"));
          } else {
            allData.push(data);
          }
          let cb: Function = null;
          if (typeof(arg2) === "function") {
            cb = arg2;
          }
          if (typeof(arg3) === "function") {
            cb = arg3;
          }
          if (typeof(cb) === "function") {
            setImmediate(cb);
          }
          return true;
        };
        const end = res.end;
        res.end = (...args: any[]) => {
          // Disable caching.
          // From: https://stackoverflow.com/questions/9884513/avoid-caching-of-the-http-responses
          // NOTE: Need to do this elsewhere? Maybe headers were already sent.
          //res.setHeader('expires', 'Tue, 03 Jul 2001 06:00:00 GMT');
          //res.setHeader('last-modified', `${(new Date()).toUTCString()}`);
          //res.setHeader('cache-control', 'max-age=0, no-cache, must-revalidate, proxy-revalidate');
          if (args[0]) {
            if (typeof(args[0]) === "string") {
              allData.push(Buffer.from(args.shift(), "utf8"));
            } else if (Buffer.isBuffer(args[0])) {
              allData.push(args.shift());
            }
          }
          let data: Buffer = Buffer.concat(allData);
          let mimeType = res.getHeader('content-type');
          let statusCode = res.statusCode;
          if (mimeType) {
            mimeType = mimeType.toLowerCase();
            // text/javascript or application/javascript
            if (mimeType.indexOf('text') !== -1 || mimeType.indexOf('application/javascript') !== -1) {
              const newFile = this._requestCb({
                status: writeHeadArgs !== null ? writeHeadArgs[0] : res.statusCode,
                mimetype: mimeType,
                url: req.url,
                contents: data.toString()
              });
              data = Buffer.from(newFile.contents, "utf8");
              res.setHeader('content-type', newFile.mimetype);
              statusCode = newFile.status;
            }
          }

          if (res.getHeader('content-length')) {
            res.removeHeader('content-length');
            res.setHeader('content-length', `${data.length}`);
          }
          res.setHeader('expires', 'Tue, 03 Jul 2001 06:00:00 GMT');
          res.setHeader('last-modified', `${(new Date()).toUTCString()}`);
          res.setHeader('cache-control', 'max-age=0, no-cache, must-revalidate, proxy-revalidate');
          if (writeHeadArgs !== null) {
            writeHead.apply(res, [statusCode].concat(writeHeadArgs.slice(1)));
          } else {
            res.statusCode = statusCode;
          }

          if (data.length > 0) {
            // Transmit data in 64K chunks.
            const numChunks = Math.ceil(data.length / 65536);
            let p = writePromise(data.slice(0, numChunks === 1 ? data.length : 65536));
            for (let i = 1; i < numChunks; i++) {
              const offset = i * 65536;
              p = p.then(() => writePromise(data.slice(offset, i === numChunks - 1 ? data.length : offset + 65536)));
            }
            p.catch((e) => { throw new Error(`??? Write failed! ${e}`) });
            p.then(() => end.apply(res, args));
          } else {
            end.apply(res, args);
          }
          return;
        };
      }
      this._proxy.web(req, res, { target: `${dest.protocol}//${dest.host}` });
    });
  }

  public listen(port: number): Promise<this> {
    return new Promise((res, rej) => {
      this._server.listen(port, (e: any) => {
        if (e) {
          rej(e);
        } else {
          res(this);
        }
      });
    });
  }

  public getHTTPPort(): number {
    return this.port;
  }

  public getHTTPSPort(): number {
    throw new Error('');
  }

  public getHost(): string {
    return 'localhost';
  }

  public onRequest(cb: (f: SourceFile) => SourceFile): void {
    this._requestCb = cb;
  }

  public shutdown(): Promise<void> {
    return new Promise<void>((res, rej) => {
      this._server.close((e: any) => {
        e ? rej(e) : res();
      });
    });
  }
}

// For type checking.
const _: IProxyConstructor<Proxy> = Proxy;
_;