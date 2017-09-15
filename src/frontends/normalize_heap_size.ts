import * as yargs from 'yargs';
import {readFileSync, createWriteStream} from 'fs';
import {parse as parseCSV} from 'papaparse';

interface Options {
  in: string;
  out: string;
}

interface Data {
  iterationCount: number;
  leaksFixed: number;
  totalSize: number;
}

const args: Options = <any> yargs
  .usage("$0 --in [file] --out [file")
  .string('in')
  .describe('in', 'Input CSV to process')
  .demand('in')
  .string('out')
  .describe('out', 'Output CSV')
  .demand('out')
  .help('help')
  .parse(process.argv);

const parsed = parseCSV(readFileSync(args.in, 'utf8'), { header: true, dynamicTyping: true });
const data: Data[] = parsed.data;
const map = new Map<number, Data[]>();
// Sort
data.forEach((d) => {
  if (d.leaksFixed === undefined) {
    return;
  }
  let m = map.get(d.leaksFixed);
  if (!m) {
    m = [];
    map.set(d.leaksFixed, m);
  }
  m[d.iterationCount] = d;
});
const out = createWriteStream(args.out);
// Compute
out.write(`leaksFixed,iterationCount,totalSize\n`)
map.forEach((d, leaksFixed) => {
  let zeroSize = d[1].totalSize;
  d.slice(2).forEach((d, iterationCount) => {
    out.write(`${leaksFixed},${iterationCount},${d.totalSize - zeroSize}\n`);
  });
});
out.end();
