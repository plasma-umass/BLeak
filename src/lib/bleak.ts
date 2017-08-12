import {proxyRewriteFunction} from './transformations';
import {IProxy, IBrowserDriver, Leak, ConfigurationFile, HeapSnapshot} from '../common/interfaces';
import {HeapGrowthTracker, GrowthObject, ToSerializeableGCPath, ToSerializeableGrowthObject, HeapGraph} from './growth_graph';
import {StackFrame} from 'error-stack-parser';
import StackFrameConverter from './stack_frame_converter';

const DEFAULT_CONFIG: ConfigurationFile = {
  name: "unknown",
  iterations: 4,
  url: "http://localhost:8080/",
  fixedLeaks: [],
  blackBox: [],
  login: [],
  setup: [],
  loop: [],
  timeout: 999999999
};
const DEFAULT_CONFIG_STRING = JSON.stringify(DEFAULT_CONFIG);

function wait(d: number): Promise<void> {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, d);
  });
}

function getConfigFromSource(configSource: string): ConfigurationFile {
  const m = {exports: Object.assign({}, DEFAULT_CONFIG) };
  // CommonJS emulation
  new Function('exports', 'module', configSource)(m.exports, m);
  return m.exports;
}

function getConfigBrowserInjection(configSource: string): string {
  // CommonJS emulation
  return `(function() {
  var module = { exports: ${DEFAULT_CONFIG_STRING} };
  var exports = module.exports;
  ${configSource}
  window.BLeakConfig = module.exports;
})();`;
}

export class BLeakDetector {
  /**
   * Find leaks in an application.
   * @param configSource The source code of the configuration file as a CommonJS module.
   * @param proxy The proxy instance that relays connections from the webpage.
   * @param driver The application driver.
   */
  public static FindLeaks(configSource: string, proxy: IProxy, driver: IBrowserDriver, snapshotCb: (sn: HeapSnapshot) => void = () => {}): Promise<Leak[]> {
    const detector = new BLeakDetector(proxy, driver, configSource, snapshotCb);
    return detector.findLeaks();
  }

  /**
   * Evaluate the effectiveness of leak fixes. Runs the application without any of the fixes,
   * and then with each fix in successive order. Outputs a CSV report to the `log` function.
   * @param configSource The source code of the configuration file as a CommonJS module.
   * @param proxy The proxy instance that relays connections from the webpage.
   * @param driver The application driver.
   * @param iterations Number of loop iterations to perform.
   * @param iterationsPerSnapshot Number of loop iterations to perform before each snapshot.
   * @param log Log function. Used to write a report. Assumes each call to `log` appends a newline.
   * @param snapshotCb (Optional) Snapshot callback.
   */
  public static EvaluateLeakFixes(configSource: string, proxy: IProxy, driver: IBrowserDriver, iterations: number, iterationsPerSnapshot: number, log: (s: string) => void, snapshotCb: (sn: HeapSnapshot) => void = () => {}): Promise<void> {
    const detector = new BLeakDetector(proxy, driver, configSource, snapshotCb);
    return detector.evaluateLeakFixes(iterations, iterationsPerSnapshot, log);
  }

  private readonly _proxy: IProxy;
  private readonly _driver: IBrowserDriver;
  private readonly _configSource: string;
  private readonly _config: ConfigurationFile;
  private readonly _growthTracker = new HeapGrowthTracker();
  private _growthObjects: GrowthObject[] = null;
  private _snapshotCb: (sn: HeapSnapshot) => void = () => {}
  private readonly _configInject: string;
  private constructor(proxy: IProxy, driver: IBrowserDriver, configSource: string, snapshotCb: (sn: HeapSnapshot) => void = () => {}) {
    this._proxy = proxy;
    this._driver = driver;
    this._configSource = configSource;
    this._config = getConfigFromSource(configSource);
    this._snapshotCb = snapshotCb;
    this._configInject = getConfigBrowserInjection(configSource);
    // Initialize proxy.
    this.configureProxy(false, []);
  }

  public configureProxy(rewriteJavaScript: boolean, fixes: number[]): void {
    this._proxy.onRequest(proxyRewriteFunction(rewriteJavaScript, this._configInject, fixes));
  }

  public async takeSnapshot(): Promise<HeapSnapshot> {
    const sn = await this._driver.takeHeapSnapshot();
    try {
      this._snapshotCb(sn);
    } catch (e) {
      console.log(`Snapshot callback exception:`);
      console.log(e);
    }
    return sn;
  }

  /**
   * Execute the given configuration.
   * @param iterations Number of loops to perform.
   * @param login Whether or not to run the login steps.
   * @param runGc Whether or not to run the GC before taking a snapshot.
   * @param takeSnapshots If true, takes snapshots after every loop and passes it to the given callback.
   */
  private async _execute(iterations: number, login: boolean, runGc: boolean = false, takeSnapshots: (sn: HeapSnapshot) => void | undefined = undefined, iterationsPerSnapshot: number = 1): Promise<void> {
    await this._driver.navigateTo(this._config.url);
    if (login) {
      await this._runLoop(false, 'login', false);
    }
    await this._runLoop(false, 'setup', false);
    for (let i = 0; i < iterations; i++) {
      const snapshotRun = takeSnapshots !== undefined && ((i + 1) % iterationsPerSnapshot) === 0;
      const sn = await this._runLoop(<any> snapshotRun, 'loop', true, runGc);
      if (snapshotRun) {
        takeSnapshots(sn);
      }
    }
  }

  public async findLeaks(): Promise<Leak[]> {
    await this._execute(this._config.iterations, true, true, (sn) => this._growthTracker.addSnapshot(sn));
    const growthObjects = this._growthObjects = this._growthTracker.getGrowingPaths();
    console.log(`Growing paths:\n${growthObjects.map((go) => go.paths[0]).map((p) => JSON.stringify(ToSerializeableGCPath(p))).join("\n")}`);
    // We now have all needed closure modifications ready.
    // Run once.
    if (growthObjects.length > 0) {
      console.log("Going to diagnose now...");
      // Flip on JS instrumentation.
      this.configureProxy(true, []);
      await this._execute(1, false)
      console.log("Instrumenting growth paths...");
      // Instrument objects to push information to global array.
      await this._instrumentGrowingObjects();
      await this._runLoop(false, 'loop', true);
      await this._runLoop(false, 'loop', true);
      // Fetch array as string.
      const growthStacks = await this._getGrowthStacks();
      const rv: Leak[] = [];
      const lookup = new Map<number, GrowthObject>();
      this._growthObjects.forEach((gl) => lookup.set(gl.node.nodeIndex, gl));
      for (const p in growthStacks) {
        const obj = lookup.get(parseInt(p, 10));
        rv.push(Object.assign({
          stacks: growthStacks[p]
        }, obj));
      }
      return rv;
    } else {
      console.log(`No growth objects found!`);
      return [];
    }
  }

  public async evaluateLeakFixes(iterations: number, iterationsPerSnapshot: number, log: (s: string) => void): Promise<void> {
    let headerPrinted = false;
    let iterationCount = 0;
    let leaksFixed = -1;
    function snapshotReport(sn: HeapSnapshot): void {
      const g = HeapGraph.Construct(sn);
      const size = g.calculateSize();
      const data = Object.assign({ leaksFixed, iterationCount }, size);
      const keys = Object.keys(data).sort();
      if (!headerPrinted) {
        log(keys.join(","));
        headerPrinted = true;
      }
      log(keys.map((k) => (<any> data)[k]).join(","));
    }
    // Disable fixes for base case.
    this.configureProxy(false, []);
    for (let i = 0; i <= this._config.fixedLeaks.length; i++) {
      leaksFixed++;
      iterationCount = 1;
      this.configureProxy(false, this._config.fixedLeaks.slice(0, leaksFixed));
      await this._execute(1, leaksFixed === 0, true, snapshotReport, 1);
      // Reset count for loop.
      iterationCount = 0;
      for (let i = 0; i < iterations; i += iterationsPerSnapshot) {
        iterationCount += iterationsPerSnapshot;
        await this._execute(iterationCount, false, true, snapshotReport, iterationCount);
      }
    }
  }

  private async _waitUntilTrue(i: number, prop: string): Promise<void> {
    while (true) {
      const success = await this._driver.runCode(`BLeakConfig.${prop}[${i}].check()`);
      if (success === "true") {
        // Delay before returning to give browser time to "catch up".
        await wait(500);
        return;
      }
      await wait(1000);
    }
  }

  private async _nextStep(i: number, prop: string): Promise<string> {
    await this._waitUntilTrue(i, prop);
    return this._driver.runCode(`BLeakConfig.${prop}[${i}].next()`);
  }

  private _runLoop(snapshotAtEnd: false, prop: string, isLoop: boolean): Promise<void>;
  private _runLoop(snapshotAtEnd: true, prop: string, isLoop: boolean, gcBeforeSnapshot?: boolean): Promise<HeapSnapshot>;
  private async _runLoop(snapshotAtEnd: boolean, prop: string, isLoop: boolean, gcBeforeSnapshot = false): Promise<HeapSnapshot | void> {
    const numSteps: number = (<any> this._config)[prop].length;
    // let promise: Promise<string | void> = Promise.resolve();
    if (numSteps > 0) {
      for (let i = 0; i < numSteps; i++) {
        await this._nextStep(i, prop);
      }
      if (isLoop) {
        // Wait for loop to finish.
        await this._waitUntilTrue(0, prop);
      }
      if (snapshotAtEnd) {
        if (gcBeforeSnapshot) {
          await this._driver.runCode('window.gc()');
        }
        return this.takeSnapshot();
      }
    }
  }

  /**
   * Instruments the objects at the growth paths so they record stack traces whenever they expand.
   * @param ps
   */
  private _instrumentGrowingObjects(): Promise<any> {
    return this._driver.runCode(`window.$$$INSTRUMENT_PATHS$$$(${JSON.stringify(this._growthObjects.map(ToSerializeableGrowthObject))})`);
  }

  /**
   * Returns all of the stack traces associated with growing objects.
   */
  private async _getGrowthStacks(): Promise<{[p: number]: StackFrame[][]}> {
    const data = await this._driver.runCode(`window.$$$GET_STACK_TRACE$$$()`);
    return StackFrameConverter.ConvertGrowthStacks(this._proxy, JSON.parse(data));
  }
}

export default BLeakDetector;