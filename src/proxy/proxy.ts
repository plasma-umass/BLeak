import {createProxyServer} from 'http-proxy';
import {createServer as createHTTPServer, Server as HTTPServer} from 'http';
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

  private constructor(port: number = 4443) {
    this.port = port;
    this._server = createHTTPServer((req, res) => {
      // get from path
      const dest = parseURL(req.url);
      // Disable compression for now.
      req.headers['accept-encoding'] = '';
      if (req.method.toLowerCase() === 'get') {
        const write = res.write;
        const allData = new Array<Buffer>();
        res.write = (data: Buffer| string, arg2?: string | Function, arg3?: string | Function): boolean => {
          if (typeof(data) === "string") {
            allData.push(Buffer.from(data, "utf8"));
          } else {
            allData.push(data);
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
              allData.push(Buffer.from(args[0], "utf8"));
              args.shift();
            } else if (Buffer.isBuffer(args[0])) {
              allData.push(args[0]);
              args.shift();
            }
          }
          const data = Buffer.concat(allData);
          let rewrote = false;
          let mimeType = res.getHeader('content-type');
          if (mimeType) {
            mimeType = mimeType.toLowerCase();
            if (mimeType.indexOf('text') !== -1) {
              rewrote = true;
              write.call(res, this._requestCb({
                mimetype: mimeType,
                url: req.url,
                contents: data.toString()
              }).contents);
            }
          }
          if (!rewrote) {
            write.call(res, data);
          }
          return end.apply(res, args);
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