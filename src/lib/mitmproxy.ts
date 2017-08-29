import {Server as WebSocketServer} from 'ws';
import {spawn, ChildProcess} from 'child_process';
import {resolve} from 'path';
import {parseHTML, exposeClosureState, injectIntoHead} from './transformations';
import {readFileSync} from 'fs';
import {parse as parseURL, Url} from 'url';
import {waitForPort} from '../common/util';
import {get as httpGet} from 'http';
import {get as httpsGet} from 'https';

/**
 * Function that intercepts and rewrites HTTP responses.
 */
export type Interceptor = (m: InterceptedHTTPMessage) => void;

/**
 * An interceptor that does nothing.
 */
export function nopInterceptor(m: InterceptedHTTPMessage): void {}

export interface HTTPResponse {
  statusCode: number,
  headers: {[name: string]: string};
  body: Buffer;
}

interface HTTPMessageMetadata {
  request: HTTPRequestMetadata;
  response: HTTPResponseMetadata;
}

interface HTTPRequestMetadata {
  method: string;
  url: string;
  headers: [string, string][];
}

interface HTTPResponseMetadata {
  status_code: number;
  headers: [string, string][];
}

export abstract class AbstractHTTPHeaders {
  private _headers: [string, string][];
  public get headers(): [string, string][] {
    return this._headers;
  }
  constructor(headers: [string, string][]) {
    this._headers = headers;
  }

  private _indexOfHeader(name: string): number {
    const headers = this.headers;
    const len = headers.length;
    for (let i = 0; i < len; i++) {
      if (headers[i][0].toLowerCase() === name) {
        return i;
      }
    }
    return -1;
  }

  public getHeader(name: string): string {
    const index = this._indexOfHeader(name);
    if (index !== -1) {
      return this.headers[index][1];
    }
    return '';
  }

  public setHeader(name: string, value: string): void {
    const index = this._indexOfHeader(name);
    if (index !== -1) {
      this.headers[index][1] = value;
    } else {
      this.headers.push([name, value]);
    }
  }

  public removeHeader(name: string): void {
    const index = this._indexOfHeader(name);
    if (index !== -1) {
      this.headers.splice(index, 1);
    }
  }

  public clearHeaders(): void {
    this._headers = [];
  }
}

export class InterceptedHTTPResponse extends AbstractHTTPHeaders {
  public statusCode: number;

  constructor(metadata: HTTPResponseMetadata) {
    super(metadata.headers);
    this.statusCode = metadata.status_code;
    // We don't support chunked transfers. The proxy already de-chunks it for us.
    this.removeHeader('transfer-encoding');
    // MITMProxy decodes the data for us.
    this.removeHeader('content-encoding');
  }

  public toJSON(): HTTPResponseMetadata {
    return {
      status_code: this.statusCode,
      headers: this.headers
    };
  }
}

export class InterceptedHTTPRequest extends AbstractHTTPHeaders {
  public method: string;
  public rawUrl: string;
  public url: Url;

  constructor(metadata: HTTPRequestMetadata) {
    super(metadata.headers);
    this.method = metadata.method.toLowerCase();
    this.rawUrl = metadata.url;
    this.url = parseURL(this.rawUrl);
  }
}

/**
 * Represents an intercepted HTTP request/response pair.
 */
export class InterceptedHTTPMessage {
  /**
   * Unpack from a Buffer received from MITMProxy.
   * @param b
   */
  public static FromBuffer(b: Buffer): InterceptedHTTPMessage {
    const metadataSize = b.readInt32LE(0);
    const requestSize = b.readInt32LE(4);
    const responseSize = b.readInt32LE(8);
    const metadata: HTTPMessageMetadata = JSON.parse(b.toString("utf8", 12, 12 + metadataSize));
    return new InterceptedHTTPMessage(
      new InterceptedHTTPRequest(metadata.request),
      new InterceptedHTTPResponse(metadata.response),
      b.slice(12 + metadataSize, 12 + metadataSize + requestSize),
      b.slice(12 + metadataSize + requestSize, 12 + metadataSize + requestSize + responseSize)
    );
  }

  public readonly request: InterceptedHTTPRequest;
  public readonly response: InterceptedHTTPResponse;
  public readonly requestBody: Buffer;
  public get responseBody(): Buffer {
    return this._responseBody;
  }
  private _responseBody: Buffer;
  private constructor(request: InterceptedHTTPRequest, response: InterceptedHTTPResponse, requestBody: Buffer, responseBody: Buffer) {
    this.request = request;
    this.response = response;
    this.requestBody = requestBody;
    this._responseBody = responseBody;
  }

  public setResponseBody(b: Buffer) {
    this._responseBody = b;
    // Update content-length.
    this.response.setHeader('content-length', `${b.length}`);
    // TODO: Content-encoding?
  }

  /**
   * Pack into a buffer for transmission to MITMProxy.
   */
  public toBuffer(): Buffer {
    const metadata = Buffer.from(JSON.stringify(this.response), 'utf8');
    const metadataLength = metadata.length;
    const responseLength = this._responseBody.length
    const rv = Buffer.alloc(8 + metadataLength + responseLength);
    rv.writeInt32LE(metadataLength, 0);
    rv.writeInt32LE(responseLength, 4);
    metadata.copy(rv, 8);
    this._responseBody.copy(rv, 8 + metadataLength);
    return rv;
  }
}

/**
 * Class that launches MITM proxy and talks to it via WebSockets.
 */
export default class MITMProxy {
  private static _cleanup: ChildProcess[] = [];

  public static async Create(cb: Interceptor = nopInterceptor): Promise<MITMProxy> {
    // Construct WebSocket server, and wait for it to begin listening.
    const wss = new WebSocketServer({ port: 8765 });
    const proxyConnected = new Promise<void>((resolve, reject) => {
      wss.once('connection', () => {
        resolve();
      });
    });
    const mp = new MITMProxy(cb);
    // Set up WSS callbacks before MITMProxy connects.
    mp._initializeWSS(wss);
    await new Promise<void>((resolve, reject) => {
      wss.once('listening', () => {
        wss.removeListener('error', reject);
        resolve();
      });
      wss.once('error', reject);
    });

    try {
      await waitForPort(8080, 1);
      console.log(`MITMProxy already running.`);
    } catch (e) {
      console.log(`MITMProxy not running; starting up mitmproxy.`);
      // Start up MITM process.
      const mitmProcess = spawn("mitmdump", ["--anticache", "-s", resolve(__dirname, "../../../scripts/proxy.py")], {
        stdio: 'inherit'
      });
      if (MITMProxy._cleanup.push(mitmProcess) === 1) {
        process.on('SIGINT', () => {
          MITMProxy._cleanup.forEach((p) => {
            p.kill('SIGKILL');
          });
        });
      }
      mp._initializeMITMProxy(mitmProcess);
      // Wait for port 8080 to come online.
      await waitForPort(8080);
    }
    await proxyConnected;

    return mp;
  }

  private _mitmProcess: ChildProcess = null;
  private _mitmError: Error = null;
  private _wss: WebSocketServer = null;
  public cb: Interceptor;
  private _cache = new Map<string, Buffer>();

  private constructor(cb: Interceptor) {
    this.cb = cb;
  }

  private _initializeWSS(wss: WebSocketServer): void {
    this._wss = wss;
    this._wss.on('connection', (ws) => {
      ws.on('message', (message: Buffer) => {
        const original = InterceptedHTTPMessage.FromBuffer(message);
        this.cb(original);
        // Remove transfer-encoding. We don't support chunked.
        this._cache.set(original.request.rawUrl, original.responseBody);
        ws.send(original.toBuffer());
      });
    });
  }

  private _initializeMITMProxy(mitmProxy: ChildProcess): void {
    this._mitmProcess = mitmProxy;
    this._mitmProcess.on('exit', (code, signal) => {
      const index = MITMProxy._cleanup.indexOf(this._mitmProcess);
      if (index !== -1) {
        MITMProxy._cleanup.splice(index, 1);
      }
      if (code !== null) {
        if (code !== 0) {
          this._mitmError = new Error(`Process exited with code ${code}.`);
        }
      } else {
        this._mitmError = new Error(`Process exited due to signal ${signal}.`);
      }
    });
    this._mitmProcess.on('error', (err) => {
      this._mitmError = err;
    });
  }

  /**
   * Retrieves the given URL from the cache. Used for mapping stack traces
   * back to their original source lines, where there should be a 100% hit
   * rate as long as the code was requested over HTTP!
   * @param url
   */
  public getFromCache(url: string): Buffer {
    return this._cache.get(url);
  }

  /**
   * Requests the given URL from the proxy.
   */
  public async proxyGet(urlString: string): Promise<HTTPResponse> {
    const url = parseURL(urlString);
    const get = url.protocol === "http:" ? httpGet : httpsGet;
    return new Promise<HTTPResponse>((resolve, reject) => {
      const req = get({
        url: urlString,
        headers: {
          host: url.host
        },
        host: 'localhost',
        port: 8080,
        path: urlString
      }, (res) => {
        const data = new Array<Buffer>();
        res.on('data', (chunk: Buffer) => {
          data.push(chunk);
        });
        res.on('end', () => {
          const d = Buffer.concat(data);
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            body: d
          });
        });
        res.once('error', reject);
      });
      req.once('error', reject);
    });
  }

  public async shutdown(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const closeWSS = () => {
        this._wss.close((err) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        });
      };

      if (this._mitmProcess && this._mitmProcess.connected) {
        this._mitmProcess.once('exit', (code, signal) => {
          closeWSS();
        });
        this._mitmProcess.kill();
      } else {
        closeWSS();
      }
    });
  }
}

function identJSTransform(f: string, s: string) {
  return s;
}

/**
 * Retrieve a standard BLeak interceptor.
 * @param agentUrl
 * @param agentPath
 * @param rewrite
 * @param config
 * @param fixes
 */
export function getInterceptor(agentUrl: string, agentPath: string, rewrite: boolean, config = "", fixes: number[] = []): Interceptor {
  const parsedInjection = parseHTML(`<script type="text/javascript" src="${agentUrl}"></script>
    <script type="text/javascript">
      ${JSON.stringify(fixes)}.forEach(function(num) {
        $$$SHOULDFIX$$$(num, true);
      });
      ${config}
    </script>`);
  const agentData = readFileSync(agentPath);
  return (f: InterceptedHTTPMessage): void => {
    const response = f.response;
    const request = f.request;
    const method = f.request.method;
    const url = request.url;
    // Filter out non 'GET' requests
    if (method !== 'get') {
      if (method === 'post' && url.path === "/eval") {
        // Special eval handler!
        response.statusCode = 200;
        response.clearHeaders();
        const body: { scope: string, source: string } = JSON.parse(f.requestBody.toString());
        if (rewrite) {
          f.setResponseBody(Buffer.from(exposeClosureState(`eval-${Math.random()}.js`, body.source, agentUrl, body.scope), 'utf8'));
        } else {
          f.setResponseBody(Buffer.from(body.source, 'utf8'));
        }
        response.setHeader('content-type', 'text/javascript');
      }
      return;
    }

    // GET requests
    let mime = response.getHeader('content-type');
    if (mime.indexOf(";") !== -1) {
      mime = mime.slice(0, mime.indexOf(";"));
    }
    console.log(`[${response.statusCode}] ${request.rawUrl}: ${mime}`);
    // NOTE: Use `pathname`, as it cuts out query variables that may have been tacked on.
    if (url.pathname.toLowerCase() === agentUrl) {
      response.statusCode = 200;
      response.clearHeaders();
      f.setResponseBody(agentData);
      response.setHeader('content-type', 'text/javascript');
      return;
    }
    /*if (url.path.indexOf('libraries') !== -1) {
      // XXXX hot fix for mailpile
      const c = f.contents.toString();
      const magic = "tuples[3-i][2].disable,tuples[0][2].lock";
      const i = c.indexOf(magic);
      console.log(`Found jQuery text at ${i}`);
      const newC = c.slice(0, i) + "tuples[3-i][2].disable,tuples[3-i][3].disable,tuples[ 0 ][ 2 ].lock,tuples[ 0 ][ 3 ].lock" + c.slice(i + magic.length);
      f.contents = Buffer.from(newC, "utf8");
    }*/
    /*if (url.path.indexOf("app.js") !== -1) {
      // XXX hot fix 2 for mailpile
      const c = f.contents.toString();
      const magic = `EventLog.subscribe(".mail_source"`;
      const i = c.indexOf(magic);
      console.log(`Found mailsource line at ${i}`);
      const newC = c.slice(0, i) + `if (!window["$$HAS_SUBSCRIBED$$"]) window["$$HAS_SUBSCRIBED$$"] = true && EventLog.subscribe(".mail_source"` + c.slice(i + magic.length);
      f.contents = Buffer.from(newC, "utf8");
    }*/
    switch (mime) {
      case 'text/html':
      //if (f.status === 200) {
        f.setResponseBody(Buffer.from(injectIntoHead(url.pathname, Buffer.from(f.responseBody).toString("utf8"), parsedInjection, rewrite ? exposeClosureState : identJSTransform), 'utf8'));
        //}
      break;
      case 'text/javascript':
      case 'application/javascript':
      case 'text/x-javascript':
      case 'application/x-javascript':
        if (response.statusCode === 200 && rewrite) {
          console.log(`Rewriting ${request.rawUrl}...`);
          f.setResponseBody(Buffer.from(exposeClosureState(url.pathname, Buffer.from(f.responseBody).toString("utf8"), agentUrl), 'utf8'));
        }
        break;
    }
  };
}