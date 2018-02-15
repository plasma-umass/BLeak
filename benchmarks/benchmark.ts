import * as Benchmark from 'benchmark';
import {gunzipSync} from 'zlib';
import {readFileSync, readdirSync, createWriteStream} from 'fs';
import {join} from 'path';
import {SnapshotSizeSummary} from '../src/common/interfaces';
import {HeapGrowthTracker, HeapGraph} from '../src/lib/growth_graph';
import {exposeClosureState} from '../src/lib/transformations';
import HeapSnapshotParser from '../src/lib/heap_snapshot_parser';

const skipSnapshots = process.argv.indexOf("--skip-snapshots") !== -1;
let loomioSnapshots: string[] = [];
let piwikSnapshots: string[] = [];
let loomioJs: string = null;
let piwikJs: string = null;
const suite = new Benchmark.Suite('BLeak');
const snapshotDir = './benchmarks/snapshots';
const jsDir = './benchmarks/javascript';
const reportFilename = `./benchmarks/benchmark_report_${new Date().toISOString().replace(/:/g, '_')}.log`;
const benchmarkReport = createWriteStream(reportFilename)
console.log(`Writing report to ${reportFilename}`);
if (skipSnapshots) {
  console.log("Skipping snapshots.");
}

function getSnapshots(prefix: string): string[] {
  return readdirSync(snapshotDir)
    .filter((s) => s.startsWith(prefix))
    .map((s) => join(snapshotDir, s))
    .map(gunzipFile);
}

function getJavascript(file: string): string {
  return gunzipFile(join(jsDir, file));
}

function gunzipFile(file: string): string {
  return gunzipSync(readFileSync(file)).toString("utf8");
}

async function getGrowthPaths(snapshots: string[]): Promise<any> {
  const builder = new HeapGrowthTracker();
  for (const snapshot of snapshots) {
    await builder.addSnapshot(HeapSnapshotParser.FromString(snapshot));
  }
  return builder.findLeakPaths();
}

async function getHeapSize(snapshot: string): Promise<SnapshotSizeSummary> {
  const graph = await HeapGraph.Construct(HeapSnapshotParser.FromString(snapshot));
  return graph.calculateSize();
}

interface Deferred {
  resolve(): void;
}

if (!skipSnapshots) {
  suite
    .add("Loomio: Growth Paths", {
      fn: function(deferred: Deferred) {
        getGrowthPaths(loomioSnapshots).then(() => deferred.resolve());
      },
      onStart: () => {
        loomioSnapshots = getSnapshots("loomio");
      },
      defer: true
    })
    .add("Loomio: Heap Size", {
      fn: function(deferred: Deferred) {
        Promise.all(loomioSnapshots.map(getHeapSize)).then(() => deferred.resolve());
      },
      onComplete: () => {
        loomioSnapshots = [];
      },
      defer: true
    })
    .add("Piwik: Growth Paths", {
      fn: function(deferred: Deferred) {
        getGrowthPaths(piwikSnapshots).then(() => deferred.resolve());
      },
      onStart: () => {
        piwikSnapshots = getSnapshots("piwik");
      },
      defer: true
    })
    .add("Piwik: Heap Size", {
      fn: function(deferred: Deferred) {
        Promise.all(piwikSnapshots.map(getHeapSize)).then(() => deferred.resolve());
      },
      onComplete: () => {
        piwikSnapshots = [];
      },
      defer: true
    });
}
suite.add("Loomio: Expose Closure State", function() {
    exposeClosureState('loomio_vendor.js', loomioJs);
  }, {
    onStart: () => {
      loomioJs = getJavascript('loomio_vendor.js.gz');
    },
    onComplete: () => {
      loomioJs = null;
    },
    defer: false
  })
  .add("Piwik: Expose Closure State", function() {
    exposeClosureState('piwik_app.js', piwikJs);
  }, {
    onStart: () => {
      piwikJs = getJavascript('piwik_app.js.gz');
    },
    onComplete: () => {
      piwikJs = null;
    },
    defer: false
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
  });

suite.run();
