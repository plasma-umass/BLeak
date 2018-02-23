import {IProgressBar} from '../common/interfaces';
import HeapSnapshotParser from './heap_snapshot_parser';
import ChromeDriver from './chrome_driver';
import BLeakResults from './bleak_results';
import BLeakConfig from './bleak_config';
import {FindAndDiagnoseLeaks, EvaluateRankingMetricsOperation, OperationState} from './bleak_operations';

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
  public static async FindLeaks(configSource: string, progressBar: IProgressBar, driver: ChromeDriver, snapshotCb: (sn: HeapSnapshotParser) => Promise<void> = defaultSnapshotCb, bleakResults?: BLeakResults): Promise<BLeakResults> {
    const detector = new BLeakDetector(driver, progressBar, configSource, snapshotCb);
    return detector.findAndDiagnoseLeaks(bleakResults);
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
  private readonly _config: BLeakConfig;
  private _snapshotCb: (sn: HeapSnapshotParser) => Promise<void>;
  private constructor(driver: ChromeDriver, progressBar: IProgressBar, configSource: string, snapshotCb: (sn: HeapSnapshotParser) => Promise<void> = defaultSnapshotCb) {
    this._driver = driver;
    this._progressBar = progressBar;
    this._config = BLeakConfig.FromSource(configSource);
    this._snapshotCb = snapshotCb;
  }

  /**
   * Locates memory leaks on the page and diagnoses them. This is the end-to-end
   * BLeak algorithm.
   */
  public async findAndDiagnoseLeaks(bleakResults?: BLeakResults): Promise<BLeakResults> {
    const op = new FindAndDiagnoseLeaks(this._config, this._snapshotCb);
    this._progressBar.setOperationCount(op.size());
    const os = new OperationState(this._driver, this._progressBar, this._config);
    if (bleakResults) {
      os.results = bleakResults;
    }
    await op.run(os);
    return os.results;
  }

  /**
   * Given a BLeak results file, collects the information needed to evaluate the effectiveness of various metrics.
   * @param results BLeak results file from a BLeak run.
   * @param flushResults Callback that flushes the results file to disk. Called periodically when new results are added.
   * @param snapshotCb Optional callback that is called whenever a heap snapshot is taken.
   */
  public async evaluateRankingMetrics(results: BLeakResults, flushResults: (results: BLeakResults) => void, snapshotCb: (ss: HeapSnapshotParser, metric: string, leaksFixed: number, iteration: number) => Promise<void>): Promise<void> {
    const op = new EvaluateRankingMetricsOperation(this._config, results, flushResults, snapshotCb);
    this._progressBar.setOperationCount(op.size());
    const os = new OperationState(this._driver, this._progressBar, this._config);
    os.results = results;
    return op.run(os);
  }
}

export default BLeakDetector;
