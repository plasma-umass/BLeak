import {IProxy, IBrowserDriver, HeapSnapshot, SourceFile, IHTTPResponse} from '../common/interfaces';
import {createSession} from 'chrome-debugging-client';
import {ISession as ChromeSession, IAPIClient as ChromeAPIClient, IBrowserProcess as ChromeProcess, IDebuggingProtocolClient as ChromeDebuggingProtocolClient} from 'chrome-debugging-client/dist/lib/types';
import {HeapProfiler as ChromeHeapProfiler, Network as ChromeNetwork, Console as ChromeConsole, Page as ChromePage, Runtime as ChromeRuntime} from "chrome-debugging-client/dist/protocol/tot";
import {WriteStream} from 'fs';
import {request as HTTPRequest, STATUS_CODES} from 'http';
import {request as HTTPSRequest} from 'https';
import {parse as parseURL} from 'url';
import * as repl from 'repl';
import {parse as parseJavaScript} from 'esprima';
import {gunzipSync} from 'zlib';

function wait(ms: number): Promise<void> {
  return new Promise<void>((res) => {
    setTimeout(res, ms);
  });
}

/**
 * Makes an HTTP / HTTPS request on behalf of the browser.
 * @param req
 */
async function makeHttpRequest(urlString: string, method: string, headers: any, postData?: string): Promise<IHTTPResponse> {
  // console.log(req);
  const url = parseURL(urlString, false);
  const makeRequest = url.protocol === "https:" ? HTTPSRequest : HTTPRequest;
  // Prune out keep-alive.
  delete headers['connection'];
  return new Promise<IHTTPResponse>((resolve, reject) => {
    const nodeReq = makeRequest({
      protocol: url.protocol,
      host: url.hostname,
      port: +url.port,
      method: method,
      path: url.path,
      headers: headers
    }, (res) => {
      const rv: IHTTPResponse = {
        statusCode: res.statusCode,
        headers: res.headers,
        data: null
      };
      let data: Buffer[] = [];
      res.on('data', (chunk: Buffer) => {
        data.push(chunk);
      });
      res.on('end', () => {
        rv.data = Buffer.concat(data);
        resolve(rv);
      });
      res.on('error', reject);
    });
    nodeReq.on('error', reject);
    if (postData) {
      nodeReq.write(postData);
    }
    nodeReq.end();
  });
}

// Strip these headers from requests and responses.
const BAD_HEADERS = [
  "if-none-match",
  "if-modified-since",
  "content-security-policy",
  "x-webkit-csp",
  "x-content-security-policy",
  "accept-encoding",
  "content-encoding"
];

function lowerCase(s: string): string {
  return s.toLowerCase();
}

function stripHeaders(headers: any): void {
  const keys = Object.keys(headers);
  const lowerKeys = keys.map(lowerCase);
  const badHeaderIndices = BAD_HEADERS.map((h) => lowerKeys.indexOf(h));
  for (const badIndex of badHeaderIndices) {
    if (badIndex !== -1) {
      delete headers[keys[badIndex]];
    }
  }
}

/**
 * Converts the response into a base64 encoded raw response,
 * including HTTP status line and headers etc.
 */
function makeRawResponse(res: IHTTPResponse): string {
  const headers = Buffer.from(`HTTP/1.1 ${res.statusCode} ${STATUS_CODES[res.statusCode]}\r\n` +
                   `${Object.keys(res.headers).map((k) => `${k}: ${res.headers[k]}`).join("\r\n")}\r\n\r\n`, 'ascii');
  const response = Buffer.concat([headers, res.data]);
  return response.toString('base64');
}

export default class ChromeRemoteDebuggingDriver implements IProxy, IBrowserDriver {
  public static async Launch(log: WriteStream): Promise<ChromeRemoteDebuggingDriver> {
    const session = await new Promise<ChromeSession>((res, rej) => createSession(res));
    // spawns a chrome instance with a tmp user data
    // and the debugger open to an ephemeral port
    const process = await session.spawnBrowser("canary", {
      // additionalArguments: ['--headless'],
      windowSize: { width: 1920, height: 1080 }
    });
    // open the REST API for tabs
    const client = session.createAPIClient("localhost", process.remoteDebuggingPort);
    const tabs = await client.listTabs();
    const tab = tabs[0];
    await client.activateTab(tab.id);
    // open the debugger protocol
    // https://chromedevtools.github.io/devtools-protocol/
    const debugClient = await session.openDebuggingProtocol(tab.webSocketDebuggerUrl);

    const heapProfiler = new ChromeHeapProfiler(debugClient);
    const network = new ChromeNetwork(debugClient);
    const console = new ChromeConsole(debugClient);
    const page = new ChromePage(debugClient);
    const runtime = new ChromeRuntime(debugClient);
    await Promise.all([heapProfiler.enable(), network.enable({}),  console.enable(), page.enable(), runtime.enable()]);
    await network.setRequestInterceptionEnabled({ enabled: true });

    return new ChromeRemoteDebuggingDriver(log, session, process, client, debugClient, page, runtime, heapProfiler, network, console);
  }

  private _log: WriteStream;
  private _session: ChromeSession;
  private _process: ChromeProcess;
  private _client: ChromeAPIClient;
  private _debugClient: ChromeDebuggingProtocolClient;
  private _page: ChromePage;
  private _runtime: ChromeRuntime;
  private _heapProfiler: ChromeHeapProfiler;
  private _network: ChromeNetwork;
  private _console: ChromeConsole;
  private _loadedFrames = new Set<string>();
  private _onRequest: (f: SourceFile) => SourceFile = (f) => f;
  private _onEval: (scope: string, source: string) => string = (sc, so) => so;
  // URL => contents
  private _cache = new Map<string, IHTTPResponse>();

  private constructor(log: WriteStream, session: ChromeSession, process: ChromeProcess, client: ChromeAPIClient, debugClient: ChromeDebuggingProtocolClient, page: ChromePage, runtime: ChromeRuntime, heapProfiler: ChromeHeapProfiler, network: ChromeNetwork, console: ChromeConsole) {
    this._log = log;
    this._session = session;
    this._process = process;
    this._client = client;
    this._debugClient = debugClient;
    this._runtime = runtime;
    this._page = page;
    this._heapProfiler = heapProfiler;
    this._network = network;
    this._console = console;

    this._console.messageAdded = (evt) => {
      const m = evt.message;
      log.write(`[${m.level}] [${m.source}] ${m.url}:${m.line}:${m.column} ${m.text}\n`);
    };

    this._runtime.exceptionThrown = (evt) => {
      const e = evt.exceptionDetails;
      log.write(`${e.url}:${e.lineNumber}:${e.columnNumber} Uncaught ${e.exception.className}: ${e.text}\n${e.stackTrace ? e.stackTrace.description : ""}\n  ${e.stackTrace ? e.stackTrace.callFrames.map((f) => `${f.url}:${f.lineNumber}:${f.columnNumber}`).join("\n  ") : ""}\n`);
    };

    this._network.requestIntercepted = async (evt) => {
      if (evt.request.method.toLowerCase() === "post" && parseURL(evt.request.url).path === "/eval") {
        // BLeak-initiated /eval request.
        const body: { scope: string, source: string } = JSON.parse(evt.request.postData);
        const rewrite = Buffer.from(this._onEval(body.scope, body.source), 'utf8');
        this._network.continueInterceptedRequest({
          interceptionId: evt.interceptionId,
          rawResponse: makeRawResponse({
            statusCode: 200,
            headers: {
              'Content-Length': rewrite.byteLength,
              'Content-Type': 'text/javascript'
            },
            data: rewrite
          })
        });
      } else if (evt.redirectHeaders || evt.redirectUrl || evt.request.method.toLowerCase() !== "get") {
        // Allow with no modifications
        this._network.continueInterceptedRequest({
          interceptionId: evt.interceptionId
        });
      } else {
        // It's a GET request that's not redirected.
        // Attempt to fetch, pass to callback.
        const response = await this.httpGet(evt.request.url, evt.request.headers, evt.request.postData);
        // Send back to client.
        this._network.continueInterceptedRequest({
          interceptionId: evt.interceptionId,
          rawResponse: makeRawResponse(response)
        });
      }
    };

    this._page.frameStoppedLoading = (e) => {
      this._loadedFrames.add(e.frameId);
    };
  }

  public async httpGet(url: string, headers: any = { "Host": parseURL(url).host }, body?: string, fromCache = false): Promise<IHTTPResponse> {
    if (fromCache && this._cache.has(url)) {
      return this._cache.get(url);
    }

    // Remove problematic caching headers, CSP, etc.
    stripHeaders(headers);
    const response = await makeHttpRequest(url, 'get', headers, body);
    if (response.headers['content-encoding']) {
      // Sometimes, web servers don't respect our wishes and send us gzip.
      if (response.headers['content-encoding'] === "gzip") {
        response.data = gunzipSync(response.data);
      } else {
        console.warn(`Weird encoding: ${response.headers['content-encoding']}`);
      }

    }
    stripHeaders(response.headers);
    let mimeType = response.headers['content-type'] as string;
    let statusCode = response.statusCode;
    mimeType = mimeType ? mimeType.toLowerCase() : "";
    // text/javascript or application/javascript
    const newFile = this._onRequest({
      status: statusCode,
      mimetype: mimeType,
      url: url,
      contents: response.data
    });
    response.data = newFile.contents;
    response.headers['content-type'] = newFile.mimetype;
    response.statusCode = newFile.status;
    if (response.headers['content-length']) {
      response.headers['content-length'] = response.data.length;
    }
    // Disable caching.
    // From: https://stackoverflow.com/questions/9884513/avoid-caching-of-the-http-responses
    response.headers['expires'] = 'Tue, 03 Jul 2001 06:00:00 GMT';
    response.headers['last-modified'] = `${(new Date()).toUTCString()}`;
    response.headers['cache-control'] = 'max-age=0, no-cache, must-revalidate, proxy-revalidate';
    this._cache.set(url, response);
    return response;
  }

  public async navigateTo(url: string): Promise<any> {
    this._loadedFrames.clear();
    const f = await this._page.navigate({ url });
    while (!this._loadedFrames.has(f.frameId)) {
      // console.log(`Waiting for frame...`);
      await wait(5);
    }
  }
  public async runCode(expression: string): Promise<string> {
    const e = await this._runtime.evaluate({ expression, returnByValue: true });
    console.log(`${expression} => ${e.result.value}`);
    return `${e.result.value}`;
  }
  public async takeHeapSnapshot(): Promise<HeapSnapshot> {
    // TODO: Use buffers instead / parse on-the-fly?
    let buffer = "";
    // 200 KB chunks
    this._heapProfiler.addHeapSnapshotChunk = (evt) => {
      // console.log(`Chunk Size: ${evt.chunk.length} characters (${(evt.chunk.length * 2)/1024} KB)`);
      buffer += evt.chunk;
    };
    await this._heapProfiler.takeHeapSnapshot({ reportProgress: false });
//    console.log(`Total Size: ${buffer.length} characters (${buffer.length * 2 / 1024} KB)`);
    return JSON.parse(buffer);
  }
  public async debugLoop(): Promise<void> {
    const evalJavascript = (cmd: string, context: any, filename: string, callback: (e: any, result?: string) => void): void => {
      try {
        parseJavaScript(cmd);
        this.runCode(cmd).then((result) => {
          callback(null, result);
        }).catch(callback);
      } catch (e) {
        callback(new (<any>repl).Recoverable(e));
      }
    };
    return new Promise<void>((resolve, reject) => {
      const r = repl.start({ prompt: "> ", eval: evalJavascript });
      r.on('exit', resolve);
    });
  }
  public onRequest(cb: (f: SourceFile) => SourceFile): void {
    this._onRequest = cb;
  }
  public onEval(cb: (scope: string, source: string) => string) {
    this._onEval = cb;
  }
  public shutdown(): Promise<void> {
    return this._process.dispose();
  }

}
