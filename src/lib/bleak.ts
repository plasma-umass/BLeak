import {ConfigurationFile, IStack, IProgressBar, SnapshotSizeSummary} from '../common/interfaces';
import HeapSnapshotParser from './heap_snapshot_parser';
import {HeapGrowthTracker, HeapGraph, toPathTree} from './growth_graph';
import StackFrameConverter from './stack_frame_converter';
import ChromeDriver from './chrome_driver';
import {configureProxy} from '../common/util';
import LeakRoot from './leak_root';
import BLeakResults from './bleak_results';

const DEFAULT_CONFIG: ConfigurationFile = {
  name: "unknown",
  iterations: 4,
  url: "http://localhost:8080/",
  fixedLeaks: [],
  leaks: {},
  blackBox: [],
  login: [],
  setup: [],
  loop: [],
  timeout: 999999999,
  rewrite: (url, type, data, fixes) => data
};
const DEFAULT_CONFIG_STRING = JSON.stringify(DEFAULT_CONFIG);
type StepType = "login" | "setup" | "loop";

function wait(d: number): Promise<void> {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, d);
  });
}

export function getConfigFromSource(configSource: string): ConfigurationFile {
  const m = {exports: Object.assign({}, DEFAULT_CONFIG) };
  // CommonJS emulation
  new Function('exports', 'module', configSource)(m.exports, m);
  return m.exports;
}

export function getConfigBrowserInjection(configSource: string): string {
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
   * @param progressBar A progress bar, to which BLeak will print information about its progress.
   * @param driver The Chrome driver.
   */
  public static async FindLeaks(configSource: string, progressBar: IProgressBar, driver: ChromeDriver, snapshotCb: (sn: HeapSnapshotParser) => Promise<void> = defaultSnapshotCb): Promise<BLeakResults> {
    const detector = new BLeakDetector(driver, progressBar, configSource, snapshotCb);
    return detector.findAndDiagnoseLeaks();
  }

  /**
   * Evaluate the effectiveness of leak fixes. Runs the application without any of the fixes,
   * and then with each fix in successive order. Outputs a CSV report to the `log` function.
   * @param configSource The source code of the configuration file as a CommonJS module.
   * @param progressBar A progress bar, to which BLeak will print information about its progress.
   * @param driver The browser driver.
   * @param iterations Number of loop iterations to perform.
   * @param iterationsPerSnapshot Number of loop iterations to perform before each snapshot.
   * @param snapshotCb (Optional) Snapshot callback.
   */
  public static async EvaluateLeakFixes(configSource: string, progressBar: IProgressBar, driver: ChromeDriver, iterations: number, iterationsPerSnapshot: number, snapshotCb: (sn: HeapSnapshotParser, metric: string, leaksFixed: number, iteration: number) => Promise<void> = defaultSnapshotCb, resumeAt?: [number, string]): Promise<void> {
    const detector = new BLeakDetector(driver, progressBar, configSource);
    return detector.evaluateLeakFixes(iterations, iterationsPerSnapshot, snapshotCb, resumeAt);
  }

  private _driver: ChromeDriver;
  private readonly _progressBar: IProgressBar;
  //private readonly _configSource: string;
  private readonly _config: ConfigurationFile;
  private readonly _growthTracker = new HeapGrowthTracker();
  private _leakRoots: LeakRoot[] = [];
  private _snapshotCb: (sn: HeapSnapshotParser) => Promise<void>;
  private readonly _configInject: string;
  private _heapSnapshotSizeStats: SnapshotSizeSummary[] = [];
  private constructor(driver: ChromeDriver, progressBar: IProgressBar, configSource: string, snapshotCb: (sn: HeapSnapshotParser) => Promise<void> = defaultSnapshotCb) {
    this._driver = driver;
    this._progressBar = progressBar;
    //this._configSource = configSource;
    this._config = getConfigFromSource(configSource);
    this._snapshotCb = snapshotCb;
    this._configInject = getConfigBrowserInjection(configSource);
    this.configureProxy(false, []);
  }

  public configureProxy(rewriteJavaScript: boolean, fixes: number[], disableAllRewrites: boolean = false, useConfigRewrite: boolean = false): void {
    return configureProxy(this._driver.mitmProxy, this._progressBar, rewriteJavaScript, fixes, this._configInject, disableAllRewrites, useConfigRewrite ? this._config.rewrite : undefined);
  }

  public takeSnapshot(): HeapSnapshotParser {
    const sn = this._driver.takeHeapSnapshot();
    try {
      this._snapshotCb(sn);
    } catch (e) {
      this._progressBar.error(`Snapshot callback exception:`);
      this._progressBar.error(`${e}`);
    }
    return sn;
  }

  /**
   * Execute the given configuration.
   * @param iterations Number of loops to perform.
   * @param login Whether or not to run the login steps.
   * @param reason A string describing what mode BLeak is in.
   * @param runGc Whether or not to run the GC before taking a snapshot.
   * @param takeSnapshotFunction If set, takes snapshots after every loop and passes it to the given callback.
   */
  private async _execute(iterations: number, login: boolean, reason: string, takeSnapshotFunction: (sn: HeapSnapshotParser) => Promise<void | undefined> = undefined, iterationsPerSnapshot: number = 1, snapshotOnFirst = false): Promise<void> {
    this._progressBar.updateDescription(`${reason}: Navigating to ${this._config.url}`);
    await this._driver.navigateTo(this._config.url);
    if (login) {
      await this._runLoop(false, 'login', reason, false);
      await wait(1000);
      this._progressBar.updateDescription(`${reason}: Re-loading ${this._config.url}, post-login`)
      await this._driver.navigateTo(this._config.url);
    }
    await this._runLoop(false, 'setup', reason, false);
    if (takeSnapshotFunction !== undefined && snapshotOnFirst) {
      // Wait for page to load.
      this._progressBar.updateDescription(`${reason}: Waiting for page to enter first loop state (loop[0].next() === true)`)
      await this._waitUntilTrue(0, 'loop');
      this._progressBar.updateDescription(`${reason}: Taking an initial heap snapshot`);
      await takeSnapshotFunction(this.takeSnapshot());
    }
    for (let i = 0; i < iterations; i++) {
      const snapshotRun = takeSnapshotFunction !== undefined && (((i + 1) % iterationsPerSnapshot) === 0);
      const sn = await this._runLoop(<true> snapshotRun, 'loop', reason, true);
      if (snapshotRun) {
        this._progressBar.updateDescription(`${reason}: Taking a heap snapshot`);
        await takeSnapshotFunction(sn);
      }
    }
  }

  /**
   * Runs the webpage in an uninstrumented state to locate growing paths in the heap.
   */
  public async findLeakPaths(steps = this._numberOfSteps(true, false)): Promise<LeakRoot[]> {
    this._progressBar.setOperationCount(steps);
    this.configureProxy(false, this._config.fixedLeaks, undefined, true);
    await this._execute(this._config.iterations, true, 'Looking for leaks', async (sn) => {
      await this._growthTracker.addSnapshot(sn);
      this._heapSnapshotSizeStats.push(this._growthTracker.getGraph().calculateSize());
    });
    const leakRoots = this._leakRoots = this._growthTracker.findLeakPaths();
    return leakRoots;
  }

  /**
   * Returns the number of distinct steps BLeak will take in the given
   * configuration. Used for the progress bar.
   * @param find Locating leaks?
   * @param diagnose Diagnosing leaks?
   */
  private _numberOfSteps(find: boolean, diagnose: boolean): number {
    // BLeak will log in once across the two.
    let steps = this._config.login.length;
    if (find) {
      steps += this._config.setup.length;
      steps += this._config.loop.length * this._config.iterations;
    }
    if (diagnose) {
      steps += this._config.setup.length;
      steps += this._config.loop.length * 3;
    }
    return steps;
  }

  /**
   * Locates memory leaks on the page and diagnoses them. This is the end-to-end
   * BLeak algorithm.
   */
  public async findAndDiagnoseLeaks(): Promise<BLeakResults> {
    const steps = this._numberOfSteps(true, true);
    return this.diagnoseLeaks(await this.findLeakPaths(steps), true, true);
  }

  /**
   * Given a set of leak roots (accessible from multiple paths), runs the webpage in an
   * instrumented state that collects stack traces as the objects at the roots grow.
   * @param leakRoots
   */
  public async diagnoseLeaks(leakRoots: LeakRoot[], loggedIn: boolean = true, progressBarInitialized: boolean): Promise<BLeakResults> {
    if (!progressBarInitialized) {
      this._progressBar.setOperationCount(this._numberOfSteps(false, true));
    }
    const results = new BLeakResults(leakRoots, undefined, undefined, this._heapSnapshotSizeStats);
    this._heapSnapshotSizeStats = [];
    const leaksDebug = JSON.stringify(toPathTree(leakRoots));
    this._progressBar.debug(`Growing paths:\n${leaksDebug}`);
    // We now have all needed closure modifications ready.
    // Run once.
    if (leakRoots.length > 0) {
      // Flip on JS instrumentation.
      this.configureProxy(true, this._config.fixedLeaks, undefined, true);
      await this._execute(1, !loggedIn, 'Warming up for diagnosing')
      this._progressBar.updateDescription(`Diagnosing: Instrumenting leak roots`);
      // Instrument objects to push information to global array.
      await this._instrumentGrowingObjects();
      await this._runLoop(false, 'loop', 'Diagnosing', true);
      await this._runLoop(false, 'loop', 'Diagnosing', true);
      // Fetch array as string.
      const growthStacks = await this._getGrowthStacks(results);
      this._leakRoots.forEach((lr) => {
        const index = lr.id;
        const stacks = growthStacks[index] || [];
        stacks.forEach((s) => {
          lr.addStackTrace(s);
        });
      });
    }
    // GC the results.
    return results.compact();
  }

  public async evaluateLeakFixes(iterations: number, iterationsPerSnapshot: number, snapshotCb: (ss: HeapSnapshotParser, metric: string, leaksFixed: number, iteration: number) => Promise<void>, resumeAt?: [number, string]): Promise<void> {
    const pb = this._progressBar;
    let metrics = Object.keys(this._config.leaks);
    let headerPrinted = !!resumeAt;
    let iterationCount = 0;
    let leaksFixed = resumeAt ? resumeAt[0] : 0;
    let metric: string;

    let logBuffer = new Array<string>();
    function stageLog(l: string): void {
      logBuffer.push(l);
    }

    function flushLog(): void {
      for (const msg of logBuffer) {
        pb.log(msg);
      }
      logBuffer = [];
    }

    function emptyLog(): void {
      logBuffer = [];
    }

    async function snapshotReport(sn: HeapSnapshotParser): Promise<void> {
      const g = await HeapGraph.Construct(sn);
      const size = g.calculateSize();
      const data = Object.assign({ metric, leaksFixed, iterationCount }, size);
      const keys = Object.keys(data).sort();
      if (!headerPrinted) {
        pb.log(keys.join(","));
        headerPrinted = true;
      }
      stageLog(keys.map((k) => (<any> data)[k]).join(","));
      iterationCount++;
    }

    const executeWrapper = async (iterations: number, login: boolean, takeSnapshots?: (sn: HeapSnapshotParser) => Promise<void>, iterationsPerSnapshot?: number, snapshotOnFirst?: boolean): Promise<void> => {
      while (true) {
        try {
          iterationCount = 0;
          await this._execute(iterations, login, 'Evaluating Leak Fixes', takeSnapshots, iterationsPerSnapshot, snapshotOnFirst);
          flushLog();
          return;
        } catch (e) {
          this._progressBar.log(e);
          this._progressBar.log(`Timed out. Trying again.`);
          emptyLog();
          this._driver = await this._driver.relaunch();
        }
      }
    };

    // Disable fixes for base case.
    this.configureProxy(false, [], true, true);

    this._snapshotCb = function(ss) {
      return snapshotCb(ss, metric, leaksFixed, iterationCount);
    };

    let hasResumed = false;
    for (metric of metrics) {
      if (resumeAt && !hasResumed) {
        hasResumed = metric === resumeAt[1];
        if (!hasResumed) {
          continue;
        }
      }
      const leaks = this._config.leaks[metric];
      for (leaksFixed = resumeAt && metric === resumeAt[1] ? resumeAt[0] : 0; leaksFixed <= leaks.length; leaksFixed++) {
        this.configureProxy(false, leaks.slice(0, leaksFixed), true, true);
        await executeWrapper(iterations, true, snapshotReport, iterationsPerSnapshot, true);
        this._driver = await this._driver.relaunch();
      }
    }
    await this._driver.shutdown();
  }

  private async _waitUntilTrue(i: number, prop: StepType, timeoutDuration: number = this._config.timeout): Promise<void> {
    let timeoutOccurred = false;
    let timeout = setTimeout(() => timeoutOccurred = true, timeoutDuration);

    if (this._config[prop][i].sleep) {
      await wait(this._config[prop][i].sleep);
    }

    while (true) {
      try {
        const success = await this._driver.runCode<boolean>(`typeof(BLeakConfig) !== "undefined" && BLeakConfig.${prop}[${i}].check()`);
        if (success) {
          clearTimeout(timeout);
          // Delay before returning to give browser time to "catch up".
          await wait(500); // 5000
          return;
        } else if (timeoutOccurred) {
          throw new Error(`Timed out.`);
        }
      } catch (e) {
        if (timeoutOccurred) {
          throw e;
        }
        this._progressBar.error(`Exception encountered when running ${prop}[${i}].check(): ${e}`);
      }
      await wait(100); // 1000
    }
  }

  private async _nextStep(i: number, prop: StepType, reason: string): Promise<void> {
    this._progressBar.updateDescription(`${reason}: ${prop} [${i + 1}/${this._config[prop].length}] Waiting for next() === true`);
    await this._waitUntilTrue(i, prop);
    this._progressBar.updateDescription(`${reason}: ${prop} [${i + 1}/${this._config[prop].length}] Transitioning to next state`);
    // Wait before running the next step, just in case there are race conditions in the app.
    // This is, unfortunately, a common occurrence.
    await wait(2000);
    await this._driver.runCode<void>(`BLeakConfig.${prop}[${i}].next()`);
    this._progressBar.nextOperation();
  }

  private _runLoop(snapshotAtEnd: false, prop: StepType, reason: string, isLoop: boolean): Promise<void>;
  private _runLoop(snapshotAtEnd: true, prop: StepType, reason: string, isLoop: boolean): Promise<HeapSnapshotParser>;
  private async _runLoop(snapshotAtEnd: boolean, prop: StepType, reason: string, isLoop: boolean): Promise<HeapSnapshotParser | void> {
    const numSteps: number = (<any> this._config)[prop].length;
    if (numSteps > 0) {
      for (let i = 0; i < numSteps; i++) {
        try {
          await this._nextStep(i, prop, reason);
        } catch (e) {
          this._progressBar.error(`Exception encountered when running ${prop}[${i}].next(): ${e}`);
          this._progressBar.abort();
          throw e;
        }
      }
      if (isLoop) {
        this._progressBar.updateDescription(`${reason}: Waiting for page to return to first loop state (loop[0].next() === true)`)
        // Wait for loop to finish.
        await this._waitUntilTrue(0, prop);
      }
      if (snapshotAtEnd) {
        this._progressBar.updateDescription(`${reason}: Taking a heap snapshot`);
        return this.takeSnapshot();
      }
    }
  }

  /**
   * Instruments the objects at the growth paths so they record stack traces whenever they expand.
   * @param ps
   */
  private _instrumentGrowingObjects(): Promise<void> {
    return this._driver.runCode<void>(`window.$$$INSTRUMENT_PATHS$$$(${JSON.stringify(toPathTree(this._leakRoots))})`);
  }

  /**
   * Returns all of the stack traces associated with growing objects.
   */
  private async _getGrowthStacks(results: BLeakResults): Promise<{[id: number]: IStack[]}> {
    const traces = await this._driver.runCode<GrowingStackTraces>(`window.$$$GET_STACK_TRACES$$$()`);
    return StackFrameConverter.ConvertGrowthStacks(this._driver.mitmProxy, this._config.url, results, traces);
  }
}

export default BLeakDetector;