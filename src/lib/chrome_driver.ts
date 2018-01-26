import HeapSnapshotParser from '../lib/heap_snapshot_parser';
import {createSession} from 'chrome-debugging-client';
import {ISession as ChromeSession, IAPIClient as ChromeAPIClient, IBrowserProcess as ChromeProcess, IDebuggingProtocolClient as ChromeDebuggingProtocolClient} from 'chrome-debugging-client/dist/lib/types';
import {HeapProfiler as ChromeHeapProfiler, Network as ChromeNetwork, Console as ChromeConsole, Page as ChromePage, Runtime as ChromeRuntime, DOM as ChromeDOM} from "chrome-debugging-client/dist/protocol/tot";
import {WriteStream} from 'fs';
import * as repl from 'repl';
import {parse as parseJavaScript} from 'esprima';
import * as childProcess from 'child_process';
import MITMProxy from 'mitmproxy';

// HACK: Patch spawn to work around chrome-debugging-client limitation
// https://github.com/krisselden/chrome-debugging-client/issues/10
const originalSpawn = childProcess.spawn;
(<any> childProcess).spawn = function(command: string, args?: string[], options?: childProcess.SpawnOptions): childProcess.ChildProcess {
  if (args && Array.isArray(args)) {
    const index = args.indexOf("--no-proxy-server");
    if (index !== -1) {
      args.splice(index, 1);
    }
  }
  return originalSpawn.call(this, command, args, options);
}

//const PROXY_PORT = 8033;

export interface DOMNode extends ChromeDOM.Node {
  eventListenerCounts: {[name: string]: number};
}

function wait(ms: number): Promise<void> {
  return new Promise<void>((res) => {
    setTimeout(res, ms);
  });
}

function exceptionDetailsToString(e: ChromeRuntime.ExceptionDetails): string {
  return `${e.url}:${e.lineNumber}:${e.columnNumber} ${e.text} ${e.exception ? e.exception.description : ""}\n${e.stackTrace ? e.stackTrace.description : ""}\n  ${e.stackTrace ? e.stackTrace.callFrames.filter((f) => f.url !== "").map((f) => `${f.functionName ? `${f.functionName} at ` : ""}${f.url}:${f.lineNumber}:${f.columnNumber}`).join("\n  ") : ""}\n`;
}

export default class ChromeDriver {
  public static async Launch(log: WriteStream): Promise<ChromeDriver> {
    const mitmProxy = await MITMProxy.Create();
    mitmProxy.stashEnabled = true;
    const session = await new Promise<ChromeSession>((res, rej) => createSession(res));
    // spawns a chrome instance with a tmp user data
    // and the debugger open to an ephemeral port
    const chromeProcess = await session.spawnBrowser("canary", {
      // additionalArguments: ['--headless'],
      windowSize: { width: 1920, height: 1080 },
      additionalArguments: [`--proxy-server=127.0.0.1:8080`]
    });
    // open the REST API for tabs
    const client = session.createAPIClient("localhost", chromeProcess.remoteDebuggingPort);
    const tabs = await client.listTabs();
    const tab = tabs[0];
    await client.activateTab(tab.id);
    // open the debugger protocol
    // https://chromedevtools.github.io/devtools-protocol/
    const debugClient = await session.openDebuggingProtocol(tab.webSocketDebuggerUrl);

    const heapProfiler = new ChromeHeapProfiler(debugClient);
    const network = new ChromeNetwork(debugClient);
    const chromeConsole = new ChromeConsole(debugClient);
    const page = new ChromePage(debugClient);
    const runtime = new ChromeRuntime(debugClient);
    const dom = new ChromeDOM(debugClient);
    await Promise.all([heapProfiler.enable(), network.enable({}),  chromeConsole.enable(), page.enable(), runtime.enable(), dom.enable()]);
    // Intercept network requests.
    // await network.setRequestInterceptionEnabled({ enabled: true });
    // Disable cache
    await network.setCacheDisabled({ cacheDisabled: true });
    // Disable service workers
    await network.setBypassServiceWorker({ bypass: true });

    const driver = new ChromeDriver(log, mitmProxy, session, chromeProcess, client, debugClient, page, runtime, heapProfiler, network, chromeConsole, dom);
    //driver._proxy = await createProxyServer(driver, PROXY_PORT);

    return driver;
  }

  private _log: WriteStream;
  public readonly mitmProxy: MITMProxy;
  private _session: ChromeSession;
  private _process: ChromeProcess;
  private _client: ChromeAPIClient;
  private _debugClient: ChromeDebuggingProtocolClient;
  private _page: ChromePage;
  private _runtime: ChromeRuntime;
  private _heapProfiler: ChromeHeapProfiler;
  private _network: ChromeNetwork;
  private _console: ChromeConsole;
  private _dom: ChromeDOM;
  private _loadedFrames = new Set<string>();

  private constructor(log: WriteStream, mitmProxy: MITMProxy, session: ChromeSession, process: ChromeProcess, client: ChromeAPIClient, debugClient: ChromeDebuggingProtocolClient, page: ChromePage, runtime: ChromeRuntime, heapProfiler: ChromeHeapProfiler, network: ChromeNetwork, console: ChromeConsole, dom: ChromeDOM) {
    this._log = log;
    this.mitmProxy = mitmProxy;
    this._session = session;
    this._process = process;
    this._client = client;
    this._debugClient = debugClient;
    this._runtime = runtime;
    this._page = page;
    this._heapProfiler = heapProfiler;
    this._network = network;
    this._console = console;
    this._dom = dom;

    this._console.messageAdded = (evt) => {
      const m = evt.message;
      log.write(`[${m.level}] [${m.source}] ${m.url}:${m.line}:${m.column} ${m.text}\n`);
    };

    this._runtime.exceptionThrown = (evt) => {
      const e = evt.exceptionDetails;
      log.write(exceptionDetailsToString(e));
    };

    this._page.frameStoppedLoading = (e) => {
      this._loadedFrames.add(e.frameId);
    };
  }

  public async relaunch(): Promise<ChromeDriver> {
    await this.shutdown();
    const driver = await ChromeDriver.Launch(this._log);
    driver.mitmProxy.cb = this.mitmProxy.cb;
    return driver;
  }

  public async navigateTo(url: string): Promise<any> {
    this._loadedFrames.clear();
    const f = await this._page.navigate({ url });
    while (!this._loadedFrames.has(f.frameId)) {
      // console.log(`Waiting for frame...`);
      await wait(5);
    }
  }

  public async runCode<T>(expression: string): Promise<T> {
    const e = await this._runtime.evaluate({ expression, returnByValue: true });
    console.log(`${expression} => ${JSON.stringify(e.result.value)}`);
    if (e.exceptionDetails) {
      throw new Error(exceptionDetailsToString(e.exceptionDetails));
    }
    return e.result.value;
  }
  public takeHeapSnapshot(): HeapSnapshotParser {
    const parser = new HeapSnapshotParser();
    // 200 KB chunks
    this._heapProfiler.addHeapSnapshotChunk = (evt) => {
      parser.addSnapshotChunk(evt.chunk);
    };
    // Always take a DOM snapshot before taking a real snapshot.
    this._takeDOMSnapshot().then(() => {
      this._heapProfiler.takeHeapSnapshot({ reportProgress: false });
    });
    return parser;
  }
  private async _takeDOMSnapshot(): Promise<void> {
    const response = await this._runtime.evaluate({
      expression: "$$$SERIALIZE_DOM$$$()", returnByValue: true
    });
    return response.result.value;
  }
  public async debugLoop(): Promise<void> {
    const evalJavascript = (cmd: string, context: any, filename: string, callback: (e: any, result?: string) => void): void => {
      try {
        parseJavaScript(cmd);
        this.runCode(cmd).then((result) => {
          callback(null, `${result}`);
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
  public async shutdown(): Promise<void> {
    await Promise.all([this._process.dispose(), this.mitmProxy.shutdown()]);
  }
}
