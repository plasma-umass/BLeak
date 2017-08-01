import {proxyRewriteFunction} from './transformations';
import {IProxy, IBrowserDriver, Leak, ConfigurationFile, HeapSnapshot} from '../common/interfaces';
import {default as HeapGrowthTracker, constructGraph} from './growth_tracker';
import {GrowthObject, Node, Edge} from './growth_graph';
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
   * @param log Log function. Used to write a report. Assumes each call to `log` appends a newline.
   * @param snapshotCb (Optional) Snapshot callback.
   */
  public static EvaluateLeakFixes(configSource: string, proxy: IProxy, driver: IBrowserDriver, log: (s: string) => void, snapshotCb: (sn: HeapSnapshot) => void = () => {}): PromiseLike<void> {
    const detector = new BLeakDetector(proxy, driver, configSource, snapshotCb);
    return detector.evaluateLeakFixes(log);
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
   * @param takeSnapshots If true, takes snapshots after every loop and passes it to the given callback.
   */
  private _execute(iterations: number, login: boolean, takeSnapshots: (sn: HeapSnapshot) => void | undefined = undefined): PromiseLike<void> {
    let promise: PromiseLike<string | void | HeapSnapshot> = this._driver.navigateTo(this._config.url);
    if (login) {
      promise = promise.then(() => this._runLoop(false, 'login', false));
    }
    promise = promise.then(() => this._runLoop(false, 'setup', false));
    for (let i = 0; i < iterations; i++) {
      promise = promise.then(() => this._runLoop(<any> (takeSnapshots !== undefined), 'loop', true));
      if (takeSnapshots !== undefined) {
        promise = promise.then(takeSnapshots);
      }
    }
    return <PromiseLike<void>> promise;
  }

  public findLeaks(): PromiseLike<Leak[]> {
    return this._execute(this._config.iterations, true, (sn) => this._growthTracker.addSnapshot(sn))
      .then(() => {
        const growthObjects = this._growthObjects = this._growthTracker.getGrowingObjects();
        console.log(`Growing paths:\n${this._growthObjects.map((gp) => JSON.stringify(gp)).join("\n")}`);
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
                const lookup = new Map<string, GrowthObject>();
                const ranked = this._growthTracker.rankGrowingObjects(growthObjects);
                growthObjects.forEach((g) => lookup.set(g.key, g));
                for (const p in growthStacks) {
                  const obj = lookup.get(p);
                  const rm: {[m: string]: number} = {};
                  ranked.get(obj).forEach((v) => rm[v[0]] = v[1]);
                  rv.push({
                    obj: obj,
                    stacks: growthStacks[p],
                    rankMetrics: rm
                  });
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

  public evaluateLeakFixes(log: (s: string) => void): PromiseLike<void> {
    log(["Configuration","Iteration","HeapSize","Growth"].join(','));
    let iterationCount = 0;
    let lastSize = 0;
    function snapshotReport(config: string, sn: HeapSnapshot): void {
      const g = constructGraph(sn);
      const visitBit = g.visited;
      const shouldVisit = (n: Node) => n.visited !== visitBit;
      const queue = g.children.map((e) => {
        e.to.visited = visitBit;
        return e.to;
      });
      const addToQueue = (e: Edge) => {
        const n = e.to;
        if (shouldVisit(n)) {
          queue.push(n);
        }
      };
      let size = 0;
      while (queue.length > 0) {
        const n = queue.pop();
        size += n.size;
        n.children.forEach(addToQueue);
      }
      let growth = size - lastSize;
      log([config, iterationCount++, size, growth].join(","));
      lastSize = size;
    }
    // Disable fixes for base case.
    this.configureProxy(false, []);
    return this._execute(this._config.iterations, true, (sn) => {
      snapshotReport("BaseCase", sn);
    }).then(() => {
      iterationCount = 0;
      lastSize = 0;
      if (this._config.fixedLeaks.length > 0) {
        this.configureProxy(false, this._config.fixedLeaks);
        return this._execute(this._config.iterations, false, (sn) => {
          snapshotReport("LeaksFixed", sn);
        });
      } else {
        return Promise.resolve();
      }
    });
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
  private _runLoop(snapshotAtEnd: true, prop: string, isLoop: boolean): PromiseLike<HeapSnapshot>;
  private _runLoop(snapshotAtEnd: boolean, prop: string, isLoop: boolean): PromiseLike<HeapSnapshot | string | void> {
    const numSteps: number = (<any> this._config)[prop].length;
    let promise: PromiseLike<string | void> = this._nextStep(0, prop);
    if (numSteps > 1) {
      for (let i = 1; i < numSteps; i++) {
        promise = promise.then(() => this._nextStep(i, prop));
      }
    }
    if (isLoop) {
      // Wait for loop to finish.
      promise = promise.then(() => this._waitUntilTrue(0, prop));
    }
    if (snapshotAtEnd) {
      return promise.then(() => this.takeSnapshot());
    }
    return promise;
  }

  /**
   * Instruments the objects at the growth paths so they record stack traces whenever they expand.
   * @param ps
   */
  private _instrumentGrowingObjects(): PromiseLike<any> {
    return this._driver.runCode(`window.$$instrumentPaths(${JSON.stringify(this._growthObjects)})`);
  }

  /**
   * Returns all of the stack traces associated with growing objects.
   */
  private _getGrowthStacks(): PromiseLike<{[p: string]: StackFrame[][]}> {
    return <any> this._driver.runCode(`window.$$getStackTraces()`).then((data) => JSON.parse(data)).then((data) => StackFrameConverter.ConvertGrowthStacks(this._proxy, data));
  }
}

export default BLeakDetector;