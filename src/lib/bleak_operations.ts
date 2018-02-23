import ChromeDriver from './chrome_driver';
import {StepType, SnapshotSizeSummary, IProgressBar} from '../common/interfaces';
import BLeakConfig from './bleak_config';
import {wait} from '../common/util';
import HeapSnapshotParser from './heap_snapshot_parser';
import {InterceptorConfig, default as getInterceptor} from './mitmproxy_interceptor';
import BLeakResults from './bleak_results';
import {HeapGrowthTracker, HeapGraph, toPathTree} from './growth_graph';
import StackFrameConverter from './stack_frame_converter';
import PathToString from './path_to_string';

type SnapshotCb = (sn: HeapSnapshotParser) => Promise<void>;

export class OperationState {
  public results: BLeakResults = null;
  constructor(
    public chromeDriver: ChromeDriver,
    public progressBar: IProgressBar,
    public config: BLeakConfig) {}
}

const NEVER = Math.pow(2, 30);

abstract class Operation {
  constructor(private readonly _timeout: number = NEVER) {}
  // Description of the task that the operation is performing.
  public abstract description: string;
  // Returns the size of the operations graph beginning with this node.
  // Default is 1 (no dependent operations)
  public size(): number { return 1; }
  // Returns 'true' if the operation is fulfilled and can be skipped.
  // Defaults to unskippable.
  public skip(opSt: OperationState): boolean { return false; }
  // Runs the operation. Promise is resolved/rejected when completed.
  public async run(opSt: OperationState): Promise<void> {
    opSt.progressBar.updateDescription(this.description);
    if (this.skip(opSt)) {
      const size = this.size();
      for (let i = 0; i < size; i++) {
        opSt.progressBar.nextOperation();
      }
      return;
    }
    if (this._timeout === NEVER) {
      await this._run(opSt);
      opSt.progressBar.nextOperation();
      return;
    }
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        const e = new Error(`Operation timed out.`);
        this.cancel(e);
        reject(e);
      }, this._timeout);
      this._run(opSt).then(() => {
        clearTimeout(timer);
        opSt.progressBar.nextOperation();
        resolve();
      }).catch((e) => {
        clearTimeout(timer);
        reject(e);
      });
    });
  }
  // Called when a running operation is canceled. Operation should exit gracefully.
  public cancel(e: Error) {}

  // Internal function that really runs the operation.
  protected abstract _run(opSt: OperationState): Promise<void>;
}

class NavigateOperation extends Operation {
  constructor(timeout: number,
      private readonly _url: string) {
    super(timeout);
  }

  public get description(): string {
    return `Navigating to ${this._url}`;
  }

  protected _run(opSt: OperationState): Promise<void> {
    return opSt.chromeDriver.navigateTo(this._url);
  }
}

class CheckOperation extends Operation {
  private _cancelled = false;
  constructor(timeout: number,
      private readonly _stepType: StepType,
      private readonly _id: number) {
    super(timeout);
  }

  public get description(): string {
    return `Waiting for ${this._stepType}[${this._id}].check() === true`;
  }

  public cancel(e: Error) {
    this._cancelled = true;
  }

  public async _run(opSt: OperationState): Promise<void> {
    // Wait until either the operation is canceled (timeout) or the check succeeds.
    while (!this._cancelled) {
      const success = await opSt.chromeDriver.runCode<boolean>(`typeof(BLeakConfig) !== "undefined" && BLeakConfig.${this._stepType}[${this._id}].check()`);
      if (success) {
        return;
      }
      await wait(100);
    }
  }
}

class NextOperation extends Operation {
  constructor(timeout: number,
      private readonly _stepType: StepType,
      private readonly _id: number) {
    super(timeout);
  }

  public get description(): string {
    return `Advancing to next state ${this._stepType}[${this._id}].next()`;
  }

  public async _run(opSt: OperationState): Promise<void> {
    return opSt.chromeDriver.runCode<void>(`BLeakConfig.${this._stepType}[${this._id}].next()`);
  }
}

class DelayOperation extends Operation {
  constructor(private readonly _delay: number) {
    super();
  }

  public get description(): string {
    return `Waiting ${this._delay} ms before proceeding`;
  }

  public _run(): Promise<void> {
    return wait(this._delay);
  }
}

class TakeHeapSnapshotOperation extends Operation {
  constructor(timeout: number, private _snapshotCb: SnapshotCb) {
    super(timeout);
  }

  public get description(): string {
    return `Taking a heap snapshot`;
  }

  public async _run(opSt: OperationState): Promise<void> {
    const sn = opSt.chromeDriver.takeHeapSnapshot();
    return this._snapshotCb(sn);
  }
}

class ConfigureProxyOperation extends Operation {
  constructor(private _config: InterceptorConfig) {
    super();
  }

  public get description(): string {
    return `Configuring the proxy`;
  }

  public async _run(opSt: OperationState): Promise<void> {
    this._config.log = opSt.progressBar;
    opSt.chromeDriver.mitmProxy.cb = getInterceptor(this._config);
  }
}

function countOperations(sumSoFar: number, next: Operation): number {
  return sumSoFar + next.size();
}

abstract class CompositeOperation extends Operation {
  protected children: Operation[] = [];
  private _canceledError: Error = null;
  public size(): number {
    return this.children.reduce(countOperations, 1);
  }

  public cancel(e: Error): void {
    this._canceledError = e;
  }

  protected async _run(opSt: OperationState): Promise<void> {
    let promise = Promise.resolve();
    let i = 0;
    const self = this;
    function runNext(): Promise<void> | void {
      if (self._canceledError) {
        throw self._canceledError;
      }
      if (i < self.children.length) {
        return self.children[i++].run(opSt);
      }
    }
    for (let i = 0; i < this.children.length; i++) {
      promise = promise.then(runNext);
    }
    return promise;
  }
}

class StepOperation extends CompositeOperation {
  constructor(config: BLeakConfig, stepType: StepType, id: number) {
    super();
    this.children.push(new CheckOperation(config.timeout, stepType, id));
    if (config.postCheckSleep) {
      this.children.push(new DelayOperation(config.postCheckSleep));
    }
    this.children.push(new NextOperation(config.timeout, stepType, id));
    if (config.postNextSleep) {
      this.children.push(new DelayOperation(config.postNextSleep));
    }
  }

  public get description() { return ''; }
}

class InstrumentGrowingPathsOperation extends Operation {
  public get description() {
    return `Instrumenting growing objects`;
  }

  public _run(opSt: OperationState): Promise<void> {
    return opSt.chromeDriver.runCode<void>(`window.$$$INSTRUMENT_PATHS$$$(${JSON.stringify(toPathTree(opSt.results.leaks))})`);
  }
}

class StepSeriesOperation extends CompositeOperation {
  constructor(config: BLeakConfig, stepType: StepType) {
    super();
    const steps = config[stepType];
    for (let i = 0; i < steps.length; i++) {
      this.children.push(
        new StepOperation(config, stepType, i));
    }
  }

  public get description(): string { return ''; }
}

class ProgramRunOperation extends CompositeOperation {
  constructor(config: BLeakConfig, runLogin: boolean, iterations: number, takeInitialSnapshot: boolean, snapshotCb?: SnapshotCb) {
    super();
    this.children.push(new NavigateOperation(config.timeout, config.url));
    if (runLogin && config.login.length > 0) {
      this.children.push(
        new StepSeriesOperation(config, 'login'),
        new DelayOperation(config.postLoginSleep),
        new NavigateOperation(config.timeout, config.url)
      );
    }
    if (config.setup.length > 0) {
      this.children.push(
        new StepSeriesOperation(config, 'setup')
      );
    }
    if (takeInitialSnapshot && snapshotCb) {
      this.children.push(
        // Make sure we're at step 0 before taking the snapshot.
        new CheckOperation(config.timeout, 'loop', 0));
      if (config.postCheckSleep) {
        this.children.push(new DelayOperation(config.postCheckSleep));
      }
      this.children.push(new TakeHeapSnapshotOperation(config.timeout, snapshotCb));
    }
    for (let i = 0; i < iterations; i++) {
      this.children.push(
        new StepSeriesOperation(config, 'loop'),
        // Make sure we're at step 0 before taking the snapshot.
        new CheckOperation(config.timeout, 'loop', 0)
      );
      if (config.postCheckSleep) {
        this.children.push(new DelayOperation(config.postCheckSleep));
      }
      if (snapshotCb) {
        this.children.push(
          new TakeHeapSnapshotOperation(config.timeout, snapshotCb)
        );
      }
    }
  }

  public get description() { return 'Running through the program'; }
}

class FindLeaks extends CompositeOperation {
  private readonly _growthTracker = new HeapGrowthTracker();
  private _heapSnapshotSizeStats: SnapshotSizeSummary[] = [];
  constructor(config: BLeakConfig, private _snapshotCb: SnapshotCb) {
    super();
    this.children.push(
      new ConfigureProxyOperation({
        log: null,
        rewrite: false,
        fixes: config.fixedLeaks,
        disableAllRewrites: false,
        fixRewriteFunction: config.rewrite,
        config: config.getBrowserInjection()
      }),
      new ProgramRunOperation(config, true, config.iterations, false, async (sn: HeapSnapshotParser) => {
        this._snapshotCb(sn);
        await this._growthTracker.addSnapshot(sn);
        this._heapSnapshotSizeStats.push(this._growthTracker.getGraph().calculateSize());
      })
    );
  }

  public get description() { return 'Locating leaks'; }

  public skip(opSt: OperationState): boolean {
    return !!opSt.results;
  }

  protected async _run(opSt: OperationState): Promise<void> {
    await super._run(opSt);
    opSt.results = new BLeakResults(this._growthTracker.findLeakPaths(), undefined, undefined, this._heapSnapshotSizeStats);
  }
}

class GetGrowthStacksOperation extends Operation {
  constructor(timeout: number) {
    super(timeout);
  }

  public get description() { return 'Retrieving stack traces'; }

  protected async _run(opSt: OperationState): Promise<void> {
    const traces = await opSt.chromeDriver.runCode<GrowingStackTraces>(`window.$$$GET_STACK_TRACES$$$()`);
    const growthStacks = StackFrameConverter.ConvertGrowthStacks(opSt.chromeDriver.mitmProxy, opSt.config.url, opSt.results, traces);
    opSt.results.leaks.forEach((lr) => {
      const index = lr.id;
      const stacks = growthStacks[index] || [];
      stacks.forEach((s) => {
        lr.addStackTrace(s);
      });
    });
  }
}

class DiagnoseLeaks extends CompositeOperation {
  constructor(config: BLeakConfig, isLoggedIn: boolean) {
    super();
    this.children.push(
      new ConfigureProxyOperation({
        log: null,
        rewrite: true,
        fixes: config.fixedLeaks,
        config: config.getBrowserInjection(),
        fixRewriteFunction: config.rewrite
      }),
      // Warmup
      new ProgramRunOperation(config, !isLoggedIn, 1, false),
      new InstrumentGrowingPathsOperation(config.timeout),
      new StepSeriesOperation(config, 'loop'),
      new StepSeriesOperation(config, 'loop'),
      new GetGrowthStacksOperation(config.timeout)
    );
  }

  public get description() { return 'Diagnosing leaks'; }

  public skip(opSt: OperationState): boolean {
    return opSt.results.leaks.length === 0;
  }

  protected async _run(opSt: OperationState): Promise<void> {
    await super._run(opSt);
    opSt.results = opSt.results.compact();
  }
}

/**
 * A specific BLeak configuration used during ranking metric evaluation.
 * Since metrics may share specific configurations, this contains a boolean
 * indicating which metrics this configuration applies to.
 */
class RankingEvalConfig {
  public leakShare: boolean = false;
  public retainedSize: boolean = false;
  public transitiveClosureSize: boolean = false;
  constructor(public readonly fixIds: number[]) {}
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

/**
 * Given a set of leaks, return a unique key.
 * @param set
 */
function leakSetKey(set: number[]): string {
  // Canonicalize order, then produce string.
  return set.sort(increasingSort).join(',');
}

function increasingSort(a: number, b: number): number {
  return a - b;
}

class EvaluateRankingMetricProgramRunOperation extends CompositeOperation {
  private _buffer: SnapshotSizeSummary[] = [];
  constructor(
      config: BLeakConfig,
      private _rankingEvalConfig: RankingEvalConfig,
      private _runNumber: number,
      private _flushResults: (results: BLeakResults) => void,
      snapshotCb?: (ss: HeapSnapshotParser, metric: string, leaksFixed: number, iteration: number) => Promise<void>) {
    super();
    const buffer = this._buffer;
    async function snapshotReport(sn: HeapSnapshotParser): Promise<void> {
      const g = await HeapGraph.Construct(sn);
      const size = g.calculateSize();
      buffer.push(size);
    }
    this.children.push(
      new ConfigureProxyOperation({
        log: null,
        rewrite: false,
        fixes: _rankingEvalConfig.fixIds,
        disableAllRewrites: true,
        fixRewriteFunction: config.rewrite,
        config: config.getBrowserInjection()
      }),
      new ProgramRunOperation(config, false, config.rankingEvaluationIterations, true, (sn) => {
        snapshotCb(sn, this._rankingEvalConfig.metrics(), this._rankingEvalConfig.fixIds.length, this._runNumber);
        return snapshotReport(sn);
      })
    );
  }

  public get description() { return 'Running program in a configuration...' }

  public skip(opSt: OperationState) {
    const len = this._rankingEvalConfig.fixIds.length;
    for (let metric of ['leakShare', 'retainedSize', 'transitiveClosureSize']) {
      if (this._rankingEvalConfig[metric as 'leakShare']) {
        const metricStats = opSt.results.rankingEvaluation[metric as 'leakShare'];
        if (!metricStats) {
          return false;
        }
        const configStats = metricStats[len];
        if (!configStats) {
          return false;
        }
        const runStats = configStats[this._runNumber];
        if (!runStats) {
          return false;
        }
      }
    }
    return true;
  }

  protected async _run(opSt: OperationState): Promise<void> {
    await super._run(opSt);
    // Update results w/ data from run.
    ['leakShare', 'retainedSize', 'transitiveClosureSize'].forEach((metric: 'leakShare') => {
      if (!this._rankingEvalConfig[metric]) {
        return;
      }
      const metricResults = opSt.results.rankingEvaluation[metric];
      let configRuns = metricResults[this._rankingEvalConfig.fixIds.length];
      if (!configRuns) {
        configRuns = metricResults[this._rankingEvalConfig.fixIds.length] = [];
      }
      configRuns[this._runNumber] = this._buffer.slice(0);
    });
    this._flushResults(opSt.results);
  }
}

export class EvaluateRankingMetricsOperation extends CompositeOperation {
  constructor(config: BLeakConfig, results: BLeakResults, flushResults: (results: BLeakResults) => void, snapshotCb?: (ss: HeapSnapshotParser, metric: string, leaksFixed: number, iteration: number) => Promise<void>) {
    super();
    function getSorter(rankBy: "transitiveClosureSize" | "leakShare" | "retainedSize" | "ownedObjects"): (a: number, b: number) => number {
      return (a, b) => {
        return results.leaks[b].scores[rankBy] - results.leaks[a].scores[rankBy];
      };
    }
    function fixMapper(leakId: number): number {
      const str = PathToString(results.leaks[leakId].paths[0]);
      const fixId = config.fixMap[str];
      if (fixId === undefined || fixId === null) {
        throw new Error(`Unable to find fix ID for ${str}.`);
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
    for (let metric in orders) {
      if (orders.hasOwnProperty(metric)) {
        const metricCast = <'leakShare' | 'retainedSize' | 'transitiveClosureSize'> metric;
        const order = orders[metricCast];
        for (let i = 0; i <= order.length; i++) {
          // Note: When i=0, this is the empty array -- the base case.
          const configOrder = order.slice(0, i);
          const key = leakSetKey(configOrder);
          let config = configsToTest.get(key);
          if (!config) {
            config = new RankingEvalConfig(configOrder);
            configsToTest.set(key, config);
          }
          config[metricCast] = true;
        }
      }
    }
    let configs: RankingEvalConfig[] = [];
    configsToTest.forEach((config) => {
      configs.push(config);
    });
    // Now we can make these run!
    if (config.login) {
      this.children.push(
        new ConfigureProxyOperation({
          log: null,
          rewrite: false,
          fixes: [],
          disableAllRewrites: true,
          fixRewriteFunction: config.rewrite,
          config: config.getBrowserInjection()
        }),
        new NavigateOperation(config.timeout, config.url),
        new StepSeriesOperation(config, 'login'),
        new DelayOperation(config.postLoginSleep)
      );
    }
    for (const rankingConfig of configs) {
      for (let i = 0; i < config.rankingEvaluationRuns; i++) {
        this.children.push(
          new EvaluateRankingMetricProgramRunOperation(
            config, rankingConfig, i, flushResults, snapshotCb)
        );
      }
    }
  }

  public get description() { return 'Evaluating ranking metrics'; }
  public skip(opSt: OperationState) {
    if (!opSt.results.leaks || opSt.results.leaks.length < 2) {
      opSt.progressBar.log(`Unable to evaluate ranking metrics: BLeak results file does not contain more than 2 leak roots.`);
      return true;
    }
    return false;
  }
}

export class FindAndDiagnoseLeaks extends CompositeOperation {
  constructor(config: BLeakConfig, snapshotCb: SnapshotCb) {
    super();
    this.children.push(
      new FindLeaks(config, snapshotCb),
      new DiagnoseLeaks(config, true)
    );
  }
  public get description() { return "Locating and diagnosing leaks"; }
}
