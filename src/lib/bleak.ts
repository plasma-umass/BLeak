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

function wait(d: number): PromiseLike<void> {
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
  public static FindLeaks(configSource: string, proxy: IProxy, driver: IBrowserDriver, snapshotCb: (sn: HeapSnapshot) => void = () => {}): PromiseLike<Leak[]> {
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
  public static EvaluateLeakFixes(configSource: string, proxy: IProxy, driver: IBrowserDriver, iterations: number, iterationsPerSnapshot: number, log: (s: string) => void, snapshotCb: (sn: HeapSnapshot) => void = () => {}): PromiseLike<void> {
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
    this.configureProxy(false);
  }

  public configureProxy(rewriteJavaScript: boolean, fixes = this._config.fixedLeaks): void {
    this._proxy.onRequest(proxyRewriteFunction(rewriteJavaScript, this._configInject, fixes));
  }

  public takeSnapshot(): PromiseLike<HeapSnapshot> {
    return this._driver.takeHeapSnapshot().then((sn) => {
      try {
        this._snapshotCb(sn);
      } catch (e) {
        console.log(`Snapshot callback exception:`);
        console.log(e);
      }
      return sn;
    });
  }

  /**
   * Execute the given configuration.
   * @param iterations Number of loops to perform.
   * @param login Whether or not to run the login steps.
   * @param runGc Whether or not to run the GC before taking a snapshot.
   * @param takeSnapshots If true, takes snapshots after every loop and passes it to the given callback.
   */
  private _execute(iterations: number, login: boolean, runGc: boolean = false, takeSnapshots: (sn: HeapSnapshot) => void | undefined = undefined, iterationsPerSnapshot: number = 1): PromiseLike<void> {
    let promise: PromiseLike<string | void | HeapSnapshot> = this._driver.navigateTo(this._config.url);
    if (login) {
      promise = promise.then(() => this._runLoop(false, 'login', false));
    }
    promise = promise.then(() => this._runLoop(false, 'setup', false));
    for (let i = 0; i < iterations; i++) {
      const snapshotRun = takeSnapshots !== undefined && ((i + 1) % iterationsPerSnapshot) === 0;
      promise = promise.then(() => this._runLoop(<any> snapshotRun, 'loop', true, runGc));
      if (snapshotRun) {
        promise = promise.then(takeSnapshots);
      }
    }
    return <PromiseLike<void>> promise;
  }

  public findLeaks(): PromiseLike<Leak[]> {
    return this._execute(this._config.iterations, true, true, (sn) => this._growthTracker.addSnapshot(sn))
      .then(() => {
        const growthObjects = this._growthObjects = this._growthTracker.getGrowingPaths();
        console.log(`Growing paths:\n${growthObjects.map((go) => go.paths[0]).map((p) => JSON.stringify(ToSerializeableGCPath(p))).join("\n")}`);
        // We now have all needed closure modifications ready.
        // Run once.
        if (growthObjects.length > 0) {
          console.log("Going to diagnose now...");
          // Flip on JS instrumentation.
          this.configureProxy(true);
          return this._execute(1, false)
            .then(() => {
              console.log("Instrumenting growth paths...");
              // Instrument objects to push information to global array.
              return this._instrumentGrowingObjects();
            })
            // Measure growth during two loops.
            .then(() => this._runLoop(false, 'loop', true))
            .then(() => this._runLoop(false, 'loop', true))
            .then(() => {
              // Fetch array as string.
              return this._getGrowthStacks().then((growthStacks) => {
                // console.log(`Got growth stacks:\n${JSON.stringify(growthStacks)}`);
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
              });
            });
        } else {
          console.log(`No growth objects found!`);
          return [];
        }
      });
  }

  public evaluateLeakFixes(iterations: number, iterationsPerSnapshot: number, log: (s: string) => void): PromiseLike<void> {
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
    let rv: PromiseLike<void> = Promise.resolve();
    for (let i = 0; i <= this._config.fixedLeaks.length; i++) {
      rv = rv.then(() => {
        leaksFixed++;
        iterationCount = 1;
        this.configureProxy(false, this._config.fixedLeaks.slice(0, leaksFixed));
        let rv: PromiseLike<void> = this._execute(1, leaksFixed === 0, true, snapshotReport, 1).then(() => {
          // Reset count for loop.
          iterationCount = 0;
        });
        for (let i = 0; i < iterations; i += iterationsPerSnapshot) {
          rv = rv.then(() => {
            iterationCount += iterationsPerSnapshot;
            return this._execute(iterationCount, false, true, snapshotReport, iterationCount);
          });
        }
        return rv;
      });
    }
    return rv;
  }

  private _waitUntilTrue(i: number, prop: string): PromiseLike<void> {
    return this._driver.runCode(`BLeakConfig.${prop}[${i}].check()`).then((success) => {
      if (success !== "true") {
        return wait(1000).then(() => this._waitUntilTrue(i, prop));
      } else {
        return Promise.resolve();
      }
    });
  }

  private _nextStep(i: number, prop: string): PromiseLike<string> {
    return this._waitUntilTrue(i, prop).then(() => {
      return this._driver.runCode(`BLeakConfig.${prop}[${i}].next()`);
    });
  }

  private _runLoop(snapshotAtEnd: false, prop: string, isLoop: boolean): PromiseLike<string | void>;
  private _runLoop(snapshotAtEnd: true, prop: string, isLoop: boolean, gcBeforeSnapshot?: boolean): PromiseLike<HeapSnapshot>;
  private _runLoop(snapshotAtEnd: boolean, prop: string, isLoop: boolean, gcBeforeSnapshot = false): PromiseLike<HeapSnapshot | string | void> {
    const numSteps: number = (<any> this._config)[prop].length;
    let promise: PromiseLike<string | void> = Promise.resolve();
    if (numSteps > 0) {
      for (let i = 0; i < numSteps; i++) {
        promise = promise.then(() => this._nextStep(i, prop));
      }
      if (isLoop) {
        // Wait for loop to finish.
        promise = promise.then(() => this._waitUntilTrue(0, prop));
      }
      if (snapshotAtEnd) {
        if (gcBeforeSnapshot) {
          promise = promise.then(() => this._driver.runCode('window.gc()'));
        }
        return promise.then(() => this.takeSnapshot());
      }
    }
    return promise;
  }

  /**
   * Instruments the objects at the growth paths so they record stack traces whenever they expand.
   * @param ps
   */
  private _instrumentGrowingObjects(): PromiseLike<any> {
    return this._driver.runCode(`window.$$$INSTRUMENT_PATHS$$$(${JSON.stringify(this._growthObjects.map(ToSerializeableGrowthObject))})`);
  }

  /**
   * Returns all of the stack traces associated with growing objects.
   */
  private _getGrowthStacks(): PromiseLike<{[p: number]: StackFrame[][]}> {
    return <any> this._driver.runCode(`window.$$$GET_STACK_TRACE$$$()`).then((data) => JSON.parse(data)).then((data) => StackFrameConverter.ConvertGrowthStacks(this._proxy, data));
  }
}

export default BLeakDetector;