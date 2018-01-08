import * as yargs from 'yargs';
import {readFileSync, createWriteStream, existsSync} from 'fs';
import {parse as parseCSV} from 'papaparse';

interface Args {
  in: string;
  out: string;
}

interface Data {
  metric: string;
  iterationCount: number;
  leaksFixed: number;
  totalSize: number;
  averageGrowth?: number;
}

interface DataSet {
  d: Data[];
  averageGrowth?: number;
}

const args: Args = <any> yargs
  .string('in')
  .describe('in', 'Input CSV file')
  .demand('in')
  .string('out')
  .describe('out', 'Output CSV file')
  .demand('out')
  .parse(process.argv);

const parsed = parseCSV(readFileSync(args.in, 'utf8'), { header: true, dynamicTyping: true });
const data: Data[] = parsed.data;
const map = new Map<string, Map<number, DataSet>>();
// Sort
data.forEach((d) => {
  if (d.metric === undefined) {
    return;
  }
  let m = map.get(d.metric);
  if (!m) {
    m = new Map<number, DataSet>();
    map.set(d.metric, m);
  }
  let m2 = m.get(d.leaksFixed);
  if (!m2) {
    m2 = { d: [] };
    m.set(d.leaksFixed, m2);
  }
  m2.d[d.iterationCount] = d;
});
const exists = existsSync(args.out);
// Support appending to an existing file.
const out = createWriteStream(args.out, { flags: 'a' });
if (!exists) {
  out.write(`metric,leaksFixed,averageGrowth,growthRemoved,growthRemovedCDF\n`);
}
function outWrite(metric: string, leaksFixed: number, averageGrowth: number, growthRemoved: number, growthRemovedCDF: number): void {
  out.write(`${metric},${leaksFixed},${averageGrowth},${growthRemoved},${growthRemovedCDF}\n`);
}
// Average data points for each, w/ std. dev.
//
let zeroGrowth = Number.NEGATIVE_INFINITY;
map.forEach((m, metric) => {
  // Calculate average growth.
  m.forEach((allD, leaksFixed) => {
    let growth = 0;
    // Ignore first two data points, since heap stabilizes during that time.
    let d = allD.d.slice(2);
    let previous = d[0].totalSize;
    d.slice(1).forEach((d, iterationCount) => {
      growth += d.totalSize - previous;
      previous = d.totalSize;
    });
    growth = growth / (d.length - 1);
    allD.averageGrowth = growth;
    if (leaksFixed === 0 && growth > zeroGrowth) {
      zeroGrowth = growth;
    }
  });
});

map.forEach((m, metric) => {
  // Calculate heap growth removed
  m.forEach((allD, leaksFixed) => {
    const growthFixed = zeroGrowth - allD.averageGrowth;
    const growthFixedCDF = growthFixed / zeroGrowth;
    outWrite(metric, leaksFixed, allD.averageGrowth, growthFixed, growthFixedCDF);
  });
});
out.end();
