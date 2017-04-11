import {createProxyServer} from 'http-proxy';
import {createServer as createHTTPServer, Server as HTTPServer} from 'http';
import {parse as parseURL} from 'url';

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
        res.write = (data: Buffer| string, arg2?: string | Function, arg3?: string | Function): boolean => {
          // Disable caching.
          // From: https://stackoverflow.com/questions/9884513/avoid-caching-of-the-http-responses
          // NOTE: Need to do this elsewhere? Maybe headers were already sent.
          //res.setHeader('expires', 'Tue, 03 Jul 2001 06:00:00 GMT');
          //res.setHeader('last-modified', `${(new Date()).toUTCString()}`);
          //res.setHeader('cache-control', 'max-age=0, no-cache, must-revalidate, proxy-revalidate');

          let mimeType = res.getHeader('content-type');
          if (mimeType) {
            mimeType = mimeType.toLowerCase();
            if (mimeType.indexOf('text') !== -1) {
              return write.call(res, this._requestCb({
                mimetype: mimeType,
                url: req.url,
                contents: data.toString()
              }).contents);
            }
          }
          return write.call(res, data);
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