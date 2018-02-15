import {ConfigurationFile, IStack, IProgressBar, SnapshotSizeSummary} from '../common/interfaces';
import HeapSnapshotParser from './heap_snapshot_parser';
import {HeapGrowthTracker, HeapGraph, toPathTree} from './growth_graph';
import StackFrameConverter from './stack_frame_converter';
import ChromeDriver from './chrome_driver';
import {configureProxy} from '../common/util';
import LeakRoot from './leak_root';
import BLeakResults from './bleak_results';
import PathToString from './path_to_string';

const DEFAULT_CONFIG: ConfigurationFile = {
  name: "unknown",
  iterations: 8,
  rankingEvaluationIterations: 10,
  rankingEvaluationRuns: 5,
  url: "http://localhost:8080/",
  fixedLeaks: [],
  fixMap: {},
  login: [],
  setup: [],
  loop: [],
  timeout: 999999999,
  rewrite: (url, type, data, fixes) => data
};
const DEFAULT_CONFIG_STRING = JSON.stringify(DEFAULT_CONFIG);
type StepType = "login" | "setup" | "loop";

/**
 * A specific BLeak configuration used during ranking metric evaluation.
 * Since metrics may share specific configurations, this contains a boolean
 * indicating which metrics this configuration applies to.
 */
class RankingEvalConfig {
  public leakShare: boolean = false;
  public retainedSize: boolean = false;
  public transitiveClosureSize: boolean = false;
  constructor(public readonly fixIds: number[], public remainingRuns: number) {}
  public metrics(): string {
    let rv: string[] = [];
    for (let metric of ['leakShare', 'retainedSize', 'transitiveClosureSize']) {
      if (this[metric as 'leakShare']) {
        rv.push(metric);
      }
    }
    return rv.join(', ');
  }
}

function wait(d: number): Promise<void> {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, d);
  });
}

function increasingSort(a: number, b: number): number {
  return a - b;
}

/**
 * Given a set of leaks, return a unique key.
 * @param set
 */
function leakSetKey(set: number[]): string {
  // Canonicalize order, then produce string.
  return set.sort(increasingSort).join(',');
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
   * Evaluate the effectiveness of leak fixes applied in order using different metrics.
   * Runs the application without any of the fixes, and then with each fix in successive order using
   * different metrics. Mutates the BLeakResults object with the data, and calls a callback
   * periodically to flush it to disk. Intelligently resumes from a partially-completed
   * evaluation run.
   * @param configSource The source code of the configuration file as a CommonJS module.
   * @param progressBar A progress bar, to which BLeak will print information about its progress.
   * @param driver The browser driver.
   * @param results The results file from a BLeak run.
   * @param flushResults Called when the results file should be flushed to disk.
   * @param snapshotCb (Optional) Snapshot callback.
   */
  public static async EvaluateRankingMetrics(configSource: string, progressBar: IProgressBar, driver: ChromeDriver, results: BLeakResults, flushResults: (results: BLeakResults) => void, snapshotCb: (sn: HeapSnapshotParser, metric: string, leaksFixed: number, iteration: number) => Promise<void> = defaultSnapshotCb): Promise<void> {
    const detector = new BLeakDetector(driver, progressBar, configSource);
    return detector.evaluateRankingMetrics(results, flushResults, snapshotCb);;
  }

  private _driver: ChromeDriver;
  private readonly _progressBar: IProgressBar;
  private readonly _config: ConfigurationFile;
  private readonly _growthTracker = new HeapGrowthTracker();
  private _leakRoots: LeakRoot[] = [];
  private _snapshotCb: (sn: HeapSnapshotParser) => Promise<void>;
  private readonly _configInject: string;
  private _heapSnapshotSizeStats: SnapshotSizeSummary[] = [];
  private constructor(driver: ChromeDriver, progressBar: IProgressBar, configSource: string, snapshotCb: (sn: HeapSnapshotParser) => Promise<void> = defaultSnapshotCb) {
    this._driver = driver;
    this._progressBar = progressBar;
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

  /**
   * Given a BLeak results file, collects the information needed to evaluate the effectiveness of various metrics.
   * @param results BLeak results file from a BLeak run.
   * @param flushResults Callback that flushes the results file to disk. Called periodically when new results are added.
   * @param snapshotCb Optional callback that is called whenever a heap snapshot is taken.
   */
  public async evaluateRankingMetrics(results: BLeakResults, flushResults: (results: BLeakResults) => void, snapshotCb: (ss: HeapSnapshotParser, metric: string, leaksFixed: number, iteration: number) => Promise<void>): Promise<void> {
    const pb = this._progressBar;
    if (!results.leaks || results.leaks.length < 2) {
      pb.finish();
      pb.log(`BLeak results file does not contain more than 2 leak roots; nothing to do.`);
      return;
    }
    function getSorter(rankBy: "transitiveClosureSize" | "leakShare" | "retainedSize" | "ownedObjects"): (a: number, b: number) => number {
      return (a, b) => {
        return results.leaks[b].scores[rankBy] - results.leaks[a].scores[rankBy];
      };
    }
    const config = this._config;
    function fixMapper(leakId: number): number {
      const str = PathToString(results.leaks[leakId].paths[0]);
      const fixId = config.fixMap[str];
      if (fixId === undefined || fixId === null) {
        throw new Error(`Unable to find leak ID for ${str}.`);
      }
      return fixId;
    }
    function removeDupes(unique: number[], fixId: number): number[] {
      if (unique.indexOf(fixId) === -1) {
        unique.push(fixId);
      }
      return unique;
    }

    // Figure out which runs are completed and in the results file,
    const configsToTest = new Map<string, RankingEvalConfig>();
    const leaksById = results.leaks.map((l, i) => i);
    // Map from metric => list of fixes to apply, in-order.
    const orders = {
      'leakShare': leaksById.sort(getSorter('leakShare')).map(fixMapper).reduce(removeDupes, []),
      'retainedSize': leaksById.sort(getSorter('retainedSize')).map(fixMapper).reduce(removeDupes, []),
      'transitiveClosureSize': leaksById.sort(getSorter('transitiveClosureSize')).map(fixMapper).reduce(removeDupes, [])
    };
    const runsPerConfig = this._config.rankingEvaluationRuns;
    const roundTripsPerConfig = this._config.rankingEvaluationIterations;
    let completed = 0;
    let toGo = 0;
    for (let metric in orders) {
      if (orders.hasOwnProperty(metric)) {
        const metricCast = <'leakShare' | 'retainedSize' | 'transitiveClosureSize'> metric;
        const order = orders[metricCast];
        const existingData = results.rankingEvaluation[metricCast];
        // Determine how many configurations to run. Skip configurations for which we have sufficient data.
        for (let i = 0; i <= order.length; i++) {
          // Note: When i=0, this is the empty array -- the base case.
          const configOrder = order.slice(0, i);
          let existingRuns = 0;
          if (existingData.length > i) {
            existingRuns = existingData[i] ? existingData[i].length : 0;
          }
          if (existingRuns < runsPerConfig) {
            // We still need to run this config more times.
            const key = leakSetKey(configOrder);
            let config = configsToTest.get(key);
            if (!config) {
              config = new RankingEvalConfig(configOrder, runsPerConfig - existingRuns);
              configsToTest.set(key, config);
              toGo = config.remainingRuns * roundTripsPerConfig;
            }
            config[metricCast] = true;
          } else {
            completed += runsPerConfig * roundTripsPerConfig;
          }
        }
      }
    }
    // Resume progress bar.
    this._progressBar.setOperationCount(toGo + completed);
    for (let i = 0; i < completed; i++) {
      this._progressBar.nextOperation();
    }

    // Proceed to evaluate!
    const executeConfig = async (config: RankingEvalConfig): Promise<void> => {
      let login = true;
      this._snapshotCb = function(ss) {
        return snapshotCb(ss, config.metrics(), config.fixIds.length, runsPerConfig - config.remainingRuns);
      };
      let buffer: SnapshotSizeSummary[] = [];
      async function snapshotReport(sn: HeapSnapshotParser): Promise<void> {
        const g = await HeapGraph.Construct(sn);
        const size = g.calculateSize();
        buffer.push(size);
      }
      this.configureProxy(false, config.fixIds, true, true);
      while (config.remainingRuns > 0) {
        config.remainingRuns--;
        await this._execute(roundTripsPerConfig, login, 'Evaluating Leak Fixes', snapshotReport, 1, true);
        login = false;
        // Update results w/ data from run.
        ['leakShare', 'retainedSize', 'transitiveClosureSize'].forEach((metric: 'leakShare') => {
          if (!config[metric]) {
            return;
          }
          const metricResults = results.rankingEvaluation[metric];
          let configRuns = metricResults[config.fixIds.length];
          if (!configRuns) {
            configRuns = metricResults[config.fixIds.length] = [];
          }
          const run = runsPerConfig - config.remainingRuns;
          configRuns[run] = buffer.slice(0);
        });
        buffer = [];
        flushResults(results);
      }
    };

    let configs: RankingEvalConfig[] = [];
    configsToTest.forEach((config) => {
      configs.push(config);
    });

    for (const config of configs) {
      await executeConfig(config);
      this._driver = await this._driver.relaunch();
    }
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