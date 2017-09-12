import {Leak, ConfigurationFile} from '../common/interfaces';
import HeapSnapshotParser from './heap_snapshot_parser';
import {HeapGrowthTracker, GrowthObject, HeapGraph, toSerializeableGrowingPaths} from './growth_graph';
import {StackFrame} from 'error-stack-parser';
import StackFrameConverter from './stack_frame_converter';
import ChromeDriver from './chrome_driver';
import {configureProxy} from '../common/util';
import {writeFileSync} from 'fs';

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

function defaultSnapshotCb(): Promise<void> {
  return Promise.resolve();
}

export class BLeakDetector {
  /**
   * Find leaks in an application.
   * @param configSource The source code of the configuration file as a CommonJS module.
   * @param proxy The proxy instance that relays connections from the webpage.
   * @param driver The application driver.
   */
  public static async FindLeaks(configSource: string, driver: ChromeDriver, snapshotCb: (sn: HeapSnapshotParser) => Promise<void> = defaultSnapshotCb): Promise<Leak[]> {
    const detector = new BLeakDetector(driver, configSource, snapshotCb);
    return detector.findLeaks();
  }

  /**
   * Evaluate the effectiveness of leak fixes. Runs the application without any of the fixes,
   * and then with each fix in successive order. Outputs a CSV report to the `log` function.
   * @param configSource The source code of the configuration file as a CommonJS module.
   * @param driver The browser driver.
   * @param iterations Number of loop iterations to perform.
   * @param iterationsPerSnapshot Number of loop iterations to perform before each snapshot.
   * @param log Log function. Used to write a report. Assumes each call to `log` appends a newline.
   * @param snapshotCb (Optional) Snapshot callback.
   */
  public static async EvaluateLeakFixes(configSource: string, driver: ChromeDriver, iterations: number, iterationsPerSnapshot: number, log: (s: string) => void, snapshotCb: (sn: HeapSnapshotParser) => Promise<void> = defaultSnapshotCb): Promise<void> {
    const detector = new BLeakDetector(driver, configSource, snapshotCb);
    return detector.evaluateLeakFixes(iterations, iterationsPerSnapshot, log);
  }

  private readonly _driver: ChromeDriver;
  private readonly _configSource: string;
  private readonly _config: ConfigurationFile;
  private readonly _growthTracker = new HeapGrowthTracker();
  private _growthObjects: GrowthObject[] = null;
  private _snapshotCb: (sn: HeapSnapshotParser) => Promise<void>;
  private readonly _configInject: string;
  private constructor(driver: ChromeDriver, configSource: string, snapshotCb: (sn: HeapSnapshotParser) => Promise<void> = defaultSnapshotCb) {
    this._driver = driver;
    this._configSource = configSource;
    this._config = getConfigFromSource(configSource);
    this._snapshotCb = snapshotCb;
    this._configInject = getConfigBrowserInjection(configSource);
    this.configureProxy(false, []);
  }

  public configureProxy(rewriteJavaScript: boolean, fixes: number[], disableAllRewrites: boolean = false): void {
    return configureProxy(this._driver.mitmProxy, rewriteJavaScript, fixes, this._configInject, disableAllRewrites);
  }

  public takeSnapshot(): HeapSnapshotParser {
    const sn = this._driver.takeHeapSnapshot();
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
  private async _execute(iterations: number, login: boolean, takeSnapshots: (sn: HeapSnapshotParser) => Promise<void | undefined> = undefined, iterationsPerSnapshot: number = 1, snapshotOnFirst = false): Promise<void> {
    await this._driver.navigateTo(this._config.url);
    if (login) {
      await this._runLoop(false, 'login', false);
    }
    await this._runLoop(false, 'setup', false);
    if (takeSnapshots !== undefined && snapshotOnFirst) {
      // Wait for page to load.
      await await this._waitUntilTrue(0, 'loop');
      await takeSnapshots(this.takeSnapshot());
    }
    for (let i = 0; i < iterations; i++) {
      const snapshotRun = takeSnapshots !== undefined && (((i + 1) % iterationsPerSnapshot) === 0);
      const sn = await this._runLoop(<true> snapshotRun, 'loop', true);
      if (snapshotRun) {
        console.log(`Waiting 5 seconds before snapshot.`);
        await wait(5000);
        await takeSnapshots(sn);
      }
    }
  }

  public async findLeaks(): Promise<Leak[]> {
    this.configureProxy(false, this._config.fixedLeaks);
    await this._execute(this._config.iterations, true, (sn) => this._growthTracker.addSnapshot(sn));
    const growthObjects = this._growthObjects = this._growthTracker.getGrowingPaths();
    return this.findLeaksGivenObjects(growthObjects);
  }

  public async findLeaksGivenObjects(growthObjects: GrowthObject[]): Promise<Leak[]> {
    console.log(`Growing paths:\n${JSON.stringify(toSerializeableGrowingPaths(growthObjects))}`);
    // We now have all needed closure modifications ready.
    // Run once.
    if (growthObjects.length > 0) {
      writeFileSync('paths.json', JSON.stringify(toSerializeableGrowingPaths(growthObjects)));
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
    let leaksFixed = 0;
    async function snapshotReport(sn: HeapSnapshotParser): Promise<void> {
      const g = await HeapGraph.Construct(sn);
      const size = g.calculateSize();
      const data = Object.assign({ leaksFixed, iterationCount }, size);
      const keys = Object.keys(data).sort();
      if (!headerPrinted) {
        log(keys.join(","));
        headerPrinted = true;
      }
      log(keys.map((k) => (<any> data)[k]).join(","));
      iterationCount++;
    }
    // Disable fixes for base case.
    this.configureProxy(false, [], true);
    for (leaksFixed = 0; leaksFixed <= this._config.fixedLeaks.length; leaksFixed++) {
      this.configureProxy(false, this._config.fixedLeaks.slice(0, leaksFixed), true);
      iterationCount = 0;
      await this._execute(iterations, leaksFixed === 0, snapshotReport, iterationsPerSnapshot, true);
    }
  }

  private async _waitUntilTrue(i: number, prop: string): Promise<void> {
    while (true) {
      const success = await this._driver.runCode<boolean>(`BLeakConfig.${prop}[${i}].check()`);
      if (success) {
        // Delay before returning to give browser time to "catch up".
        await wait(5000);
        return;
      }
      await wait(1000);
    }
  }

  private async _nextStep(i: number, prop: string): Promise<void> {
    await this._waitUntilTrue(i, prop);
    return this._driver.runCode<void>(`BLeakConfig.${prop}[${i}].next()`);
  }

  private _runLoop(snapshotAtEnd: false, prop: string, isLoop: boolean): Promise<void>;
  private _runLoop(snapshotAtEnd: true, prop: string, isLoop: boolean): Promise<HeapSnapshotParser>;
  private async _runLoop(snapshotAtEnd: boolean, prop: string, isLoop: boolean): Promise<HeapSnapshotParser | void> {
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
        return this.takeSnapshot();
      }
    }
  }

  /**
   * Instruments the objects at the growth paths so they record stack traces whenever they expand.
   * @param ps
   */
  private _instrumentGrowingObjects(): Promise<void> {
    return this._driver.runCode<void>(`window.$$$INSTRUMENT_PATHS$$$(${JSON.stringify(toSerializeableGrowingPaths(this._growthObjects))})`);
  }

  /**
   * Returns all of the stack traces associated with growing objects.
   */
  private async _getGrowthStacks(): Promise<{[id: number]: StackFrame[][]}> {
    const traces = await this._driver.runCode<GrowingStackTraces>(`window.$$$GET_STACK_TRACES$$$()`);
    return StackFrameConverter.ConvertGrowthStacks(this._driver.mitmProxy, this._config.url, traces);
  }
}

export default BLeakDetector;