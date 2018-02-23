import HeapSnapshotParser from '../lib/heap_snapshot_parser';
import {createSession} from 'chrome-debugging-client';
import {ISession as ChromeSession, IBrowserProcess as ChromeProcess} from 'chrome-debugging-client/dist/lib/types';
import {HeapProfiler as ChromeHeapProfiler, Network as ChromeNetwork, Console as ChromeConsole, Page as ChromePage, Runtime as ChromeRuntime, DOM as ChromeDOM} from "chrome-debugging-client/dist/protocol/tot";
import {accessSync} from 'fs';
import {join} from 'path';
import * as repl from 'repl';
import {parse as parseJavaScript} from 'esprima';
import * as childProcess from 'child_process';
import MITMProxy from 'mitmproxy';
import {platform} from 'os';
import {Log} from '../common/interfaces';
import {wait} from '../common/util';

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

export interface DOMNode extends ChromeDOM.Node {
  eventListenerCounts: {[name: string]: number};
}

function exceptionDetailsToString(e: ChromeRuntime.ExceptionDetails): string {
  return `${e.url}:${e.lineNumber}:${e.columnNumber} ${e.text} ${e.exception ? e.exception.description : ""}\n${e.stackTrace ? e.stackTrace.description : ""}\n  ${e.stackTrace ? e.stackTrace.callFrames.filter((f) => f.url !== "").map((f) => `${f.functionName ? `${f.functionName} at ` : ""}${f.url}:${f.lineNumber}:${f.columnNumber}`).join("\n  ") : ""}\n`;
}

/**
 * Spawns a chrome instance with a tmp user data and the debugger open to an ephemeral port
 */
function spawnChromeBrowser(session: ChromeSession, headless: boolean, width: number, height: number): Promise<ChromeProcess> {
  const additionalChromeArgs = [`--proxy-server=127.0.0.1:8080`, `--disable-background-timer-throttling`, `--disable-renderer-backgrounding`, `--disable-renderer-priority-management`];
  if (headless) {
    // --disable-gpu required for Windows
    additionalChromeArgs.push(`--headless`, `--disable-gpu`);
  }
  const baseOptions = {
    // additionalArguments: ['--headless'],
    windowSize: { width: width, height: height },
    additionalArguments: additionalChromeArgs
  };
  switch (platform()) {
    case 'darwin':
      return session.spawnBrowser("system", baseOptions);
    case 'freebsd':
    case 'linux':
    case 'openbsd': {
      // *nix; need to find the exact path to Chrome / Chromium
      // .trim() removes trailing newline from `which` output.
      let chromePath = childProcess.execSync(`which google-chrome`).toString().trim();
      if (chromePath === "") {
        // Try Chromium
        chromePath = childProcess.execSync(`which chromium`).toString().trim();
      }
      if (chromePath === "") {
        return Promise.reject(`Unable to find a Google Chrome or Chromium installation.`)
      }
      return session.spawnBrowser("exact", Object.assign({
        executablePath: chromePath
      }, baseOptions));
    }
    case 'win32': {
      // Inspired by karma-chrome-launcher
      // https://github.com/karma-runner/karma-chrome-launcher/blob/master/index.js
      const suffix = `\\Google\\Chrome\\Application\\chrome.exe`;
      const prefixes = [process.env.LOCALAPPDATA, process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)']];
      for (const prefix of prefixes) {
        try {
          let chromeLocation = join(prefix, suffix);
          accessSync(chromeLocation);
          return session.spawnBrowser("exact", Object.assign({
            executablePath: chromeLocation
          }, baseOptions));
        } catch (e) {}
      }
      return Promise.reject(`Unable to find a Chrome installation`);
    }
    default:
      // Esoteric options
      return Promise.reject(`Unsupported platform: ${platform()}`);
  }
}

export default class ChromeDriver {
  public static async Launch(log: Log, headless: boolean, width: number, height: number, interceptPaths: string[] = [], quiet: boolean = true): Promise<ChromeDriver> {
    const mitmProxy = await MITMProxy.Create(undefined, interceptPaths, quiet);
    // Tell mitmProxy to stash data requested through the proxy.
    mitmProxy.stashEnabled = true;
    const session = await new Promise<ChromeSession>((res, rej) => createSession(res));
    let chromeProcess: ChromeProcess = await spawnChromeBrowser(session, headless, width, height);
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

    const driver = new ChromeDriver(log, headless, width, height, interceptPaths, quiet, mitmProxy, chromeProcess, page, runtime, heapProfiler, chromeConsole);

    return driver;
  }

  private _log: Log;
  private _headless: boolean;
  public readonly mitmProxy: MITMProxy;
  private _process: ChromeProcess;
  private _page: ChromePage;
  private _runtime: ChromeRuntime;
  private _heapProfiler: ChromeHeapProfiler;
  private _console: ChromeConsole;
  private _loadedFrames = new Set<string>();
  private _shutdown: boolean = false;
  private _width: number;
  private _height: number;
  private _interceptPaths: string[];
  private _quiet: boolean;

  private constructor(log: Log, headless: boolean, width: number, height: number, interceptPaths: string[], quiet: boolean, mitmProxy: MITMProxy, process: ChromeProcess, page: ChromePage, runtime: ChromeRuntime, heapProfiler: ChromeHeapProfiler, console: ChromeConsole) {
    this._log = log;
    this._headless = headless;
    this.mitmProxy = mitmProxy;
    this._process = process;
    this._runtime = runtime;
    this._page = page;
    this._heapProfiler = heapProfiler;
    this._console = console;
    this._width = width;
    this._height = height;
    this._interceptPaths = interceptPaths;
    this._quiet = quiet;

    this._console.messageAdded = (evt) => {
      const m = evt.message;
      log.debug(`[${m.level}] [${m.source}] ${m.url}:${m.line}:${m.column} ${m.text}`);
    };

    this._runtime.exceptionThrown = (evt) => {
      const e = evt.exceptionDetails;
      log.error(exceptionDetailsToString(e));
    };

    this._page.frameStoppedLoading = (e) => {
      this._loadedFrames.add(e.frameId);
    };
  }

  public async takeScreenshot(): Promise<Buffer> {
    const ss = await this._page.captureScreenshot({});
    return Buffer.from(ss.data, 'base64');
  }

  public async relaunch(): Promise<ChromeDriver> {
    await this.shutdown();
    const driver = await ChromeDriver.Launch(this._log, this._headless, this._width, this._height, this._interceptPaths, this._quiet);
    driver.mitmProxy.cb = this.mitmProxy.cb;
    return driver;
  }

  public async navigateTo(url: string): Promise<any> {
    this._loadedFrames.clear();
    const f = await this._page.navigate({ url });
    while (!this._loadedFrames.has(f.frameId)) {
      if (this._shutdown) {
        return Promise.reject(`Cannot navigate to URL; Chrome has shut down.`);
      }
      await wait(5);
    }
  }

  public async runCode<T>(expression: string): Promise<T> {
    const e = await this._runtime.evaluate({ expression, returnByValue: true });
    this._log.debug(`${expression} => ${JSON.stringify(e.result.value)}`);
    if (e.exceptionDetails) {
      return Promise.reject(exceptionDetailsToString(e.exceptionDetails));
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
    this._shutdown = true;
    await Promise.all([this._process.dispose(), this.mitmProxy.shutdown()]);
  }
}
