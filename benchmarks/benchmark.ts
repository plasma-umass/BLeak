import * as Benchmark from 'benchmark';
import {gunzipSync} from 'zlib';
import {readFileSync, readdirSync, createWriteStream} from 'fs';
import {join} from 'path';
import {HeapSnapshot, SnapshotSizeSummary} from '../src/common/interfaces';
import {HeapGrowthTracker, HeapGraph} from '../src/lib/growth_graph';
import {exposeClosureState} from '../src/lib/transformations';

const skipSnapshots = process.argv.indexOf("--skip-snapshots") !== -1;
let loomioSnapshots: HeapSnapshot[] = [];
let piwikSnapshots: HeapSnapshot[] = [];
let loomioJs: string = null;
let piwikJs: string = null;
const suite = new Benchmark.Suite();
const snapshotDir = './benchmarks/snapshots';
const jsDir = './benchmarks/javascript';
const reportFilename = `./benchmarks/benchmark_report_${new Date().toISOString()}.log`;
const benchmarkReport = createWriteStream(reportFilename)
console.log(`Writing report to ${reportFilename}`);
if (skipSnapshots) {
  console.log("Skipping snapshots.");
}

function getSnapshots(prefix: string): HeapSnapshot[] {
  return readdirSync(snapshotDir)
    .filter((s) => s.startsWith(prefix))
    .map((s) => join(snapshotDir, s))
    .map((s) => JSON.parse(gunzipFile(s)));
}

function getJavascript(file: string): string {
  return gunzipFile(join(jsDir, file));
}

function gunzipFile(file: string): string {
  return gunzipSync(readFileSync(file)).toString("utf8");
}

function getGrowthPaths(snapshots: HeapSnapshot[]): any {
  const builder = new HeapGrowthTracker();
  for (const snapshot of snapshots) {
    builder.addSnapshot(snapshot);
  }
  return builder.getGrowingPaths();
}

function getHeapSize(snapshot: HeapSnapshot): SnapshotSizeSummary {
  return HeapGraph.Construct(snapshot).calculateSize();
}

if (!skipSnapshots) {
  suite
    .add("Loomio: Growth Paths", function() {
      getGrowthPaths(loomioSnapshots);
    }, {
      onStart: () => {
        loomioSnapshots = getSnapshots("loomio");
      }
    })
    .add("Loomio: Heap Size", function() {
      loomioSnapshots.forEach(getHeapSize);
    }, {
      onComplete: () => {
        loomioSnapshots = [];
      }
    })
    .add("Piwik: Growth Paths", function() {
      getGrowthPaths(piwikSnapshots);
    }, {
      onStart: () => {
        piwikSnapshots = getSnapshots("piwik");
      }
    })
    .add("Piwik: Heap Size", function() {
      piwikSnapshots.forEach(getHeapSize);
    }, {
      onComplete: () => {
        piwikSnapshots = [];
      }
    });
}
suite.add("Loomio: Expose Closure State", function() {
    exposeClosureState('loomio_vendor.js', loomioJs, false);
  }, {
    onStart: () => {
      loomioJs = getJavascript('loomio_vendor.js.gz');
    },
    onComplete: () => {
      loomioJs = null;
    }
  })
  .add("Piwik: Expose Closure State", function() {
    exposeClosureState('piwik_app.js', piwikJs, false);
  }, {
    onStart: () => {
      piwikJs = getJavascript('piwik_app.js.gz');
    },
    onComplete: () => {
      piwikJs = null;
    }
  })
  // add listeners
  .on('cycle', function(event: any) {
    const str = String(event.target);
    console.log(str);
    benchmarkReport.write(str + "\n");
  })
  .on('complete', function() {
    benchmarkReport.end();
  })
  .on('error', function(e: any) {
    console.log("Received error!");
    console.log(e);
  })

suite.run();
