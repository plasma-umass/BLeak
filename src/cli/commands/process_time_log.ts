import {readFileSync} from 'fs';
import {CommandModule} from 'yargs';
import {OperationType} from '../../common/interfaces';
import {TimeLogEntry} from '../../common/time_log';
import {notEqual as assertNotEqual, equal as assertEqual} from 'assert';
import {basename} from 'path';

interface CommandLineArgs {
  log: string;
}

const ProcessTimeLog: CommandModule = {
  command: 'process-time-log',
  describe: 'Produces interesting data from a log produced by a BLeak run.',
  builder: {
    log: {
      type: 'string',
      demand: true,
      describe: `Path to a BLeak time_log.json`
    }
  },
  handler: async (args: CommandLineArgs) => {
    const log: TimeLogEntry[] = JSON.parse(readFileSync(args.log).toString());
    const entriesByType = new Map<OperationType, TimeLogEntry[]>();
    for (const e of log) {
      let arr = entriesByType.get(e.type);
      if (!arr) {
        arr = [];
        entriesByType.set(e.type, arr);
      }
      arr.push(e);
    }

    function sum(nums: number[]): number {
      let sum = 0;
      for (let num of nums) {
        sum += num;
      }
      return sum;
    }

    function duration(e: TimeLogEntry): number {
      return e.end - e.start;
    }

    function formatTimeNumber(n: number): string {
      return `${n.toFixed(2)} ms`;
    }

    function printOne(type: OperationType) {
      const entries = entriesByType.get(type);
      assertNotEqual(entries, null);
      assertEqual(entries.length, 1);
      const e = entries[0];
      console.log(`${type}: ${formatTimeNumber(duration(e))}`);
    }

    function printSummary(name: string, entries: TimeLogEntry[]): void {
      console.log(`${name}: ${formatTimeNumber(sum(entries.map(duration)))}`);
    }

    function printSummaryOfOne(type: OperationType): void {
      printSummary(type, entriesByType.get(type));
    }

    function combineTypes(types: OperationType[]): TimeLogEntry[] {
      let rv: TimeLogEntry[] = [];
      for (const t of types) {
        const entries = entriesByType.get(t);
        if (entries) {
          rv = rv.concat(entries);
        }
      }
      return rv;
    }

    printOne(OperationType.LEAK_IDENTIFICATION_AND_RANKING);
    printOne(OperationType.LEAK_DIAGNOSES);
    printOne(OperationType.FIND_LEAK_PATHS);
    printOne(OperationType.CALCULATE_METRICS);
    printOne(OperationType.GET_GROWTH_STACKS);
    printSummaryOfOne(OperationType.WAIT_FOR_PAGE);
    printSummaryOfOne(OperationType.HEAP_SNAPSHOT_PARSE);
    printSummaryOfOne(OperationType.PROPAGATE_GROWTH);
    printSummaryOfOne(OperationType.SLEEP);
    printSummaryOfOne(OperationType.NAVIGATE);
    printSummaryOfOne(OperationType.PROXY_RUNNING);
    printSummary("ProxyRewriteProcessing", combineTypes([
      OperationType.PROXY_REWRITE,
      OperationType.PROXY_DIAGNOSIS_REWRITE,
      OperationType.PROXY_EVAL_REWRITE,
      OperationType.PROXY_EVAL_DIAGNOSIS_REWRITE,
      OperationType.PROXY_HTML_REWRITE
    ]));

    const runtime = sum(combineTypes([
      OperationType.LEAK_IDENTIFICATION_AND_RANKING,
      OperationType.LEAK_DIAGNOSES]).map(duration));
    const waiting = sum(combineTypes([
      OperationType.WAIT_FOR_PAGE,
      OperationType.NAVIGATE,
      OperationType.SLEEP
    ]).map(duration));
    const proxyRunning = sum(entriesByType.get(OperationType.PROXY_RUNNING).map(duration));
    const heapSnapshotTransmission = sum(entriesByType.get(OperationType.HEAP_SNAPSHOT_PARSE).map(duration));
    const propagateGrowth = sum(entriesByType.get(OperationType.PROPAGATE_GROWTH).map(duration));
    const calculateMetrics = sum(entriesByType.get(OperationType.CALCULATE_METRICS).map(duration));
    const findLeakPaths = sum(entriesByType.get(OperationType.FIND_LEAK_PATHS).map(duration));
    const getGrowthStacks = sum(entriesByType.get(OperationType.GET_GROWTH_STACKS).map(duration));
    // Total time: LIAR + LD.

    // Then print percentages.
    // (WAIT_FOR_PAGE + NAVIGATE + SLEEP) - ProxyRunning

    console.log(`------------------------------------`);
    console.log(`benchmark,activity,duration,durationPercent`);
    let bmName = basename(args.log);
    bmName = bmName.slice(0, bmName.lastIndexOf('.'));
    function printColumn(activity: string, duration: number): void {
      console.log(`${bmName},${activity},${duration},${(duration/runtime)*100}`);
    }
    printColumn('Runtime', runtime);
    printColumn('Waiting', waiting-proxyRunning);
    printColumn('Proxy', proxyRunning);
    printColumn('Parsing heap snapshot', heapSnapshotTransmission);
    printColumn('Algorithms', propagateGrowth + calculateMetrics + findLeakPaths);
    printColumn('PropagateGrowth', propagateGrowth);
    printColumn('Calculating metrics', calculateMetrics);
    printColumn('FindLeakPaths', findLeakPaths);
    printColumn('GetGrowthStacks', getGrowthStacks);
    printColumn('Other', runtime - waiting - heapSnapshotTransmission - propagateGrowth - calculateMetrics - findLeakPaths - getGrowthStacks);
  }
};

export default ProcessTimeLog;
