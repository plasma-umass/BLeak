import {HeapGrowthTracker} from '../lib/growth_graph';
import pathToString from '../lib/path_to_string';
import {createReadStream, createWriteStream} from 'fs';
import HeapSnapshotParser from '../lib/heap_snapshot_parser';
import {createGunzip} from 'zlib';
import * as yargs from 'yargs';

interface CommandLineArgs {
  out: string;
  _: string[];
}

const args: CommandLineArgs = <any> yargs.number('proxy-port')
  .usage("$0 --out [file.csv] [snap1.json.gz] [snap2.json.gz] ...")
  .string('out')
  .describe('out', `File to output information to.`)
  .demand('out')
  .help('help')
  .parse(process.argv);

function getHeapSnapshotParser(file: string): HeapSnapshotParser {
  const parser = new HeapSnapshotParser();
  const stream = createReadStream(file).pipe(createGunzip());
  stream.on('data', function(d) {
    parser.addSnapshotChunk(d.toString());
  });
  return parser;
}

async function main() {
  const files = args._.slice(2);
  const out = createWriteStream(args.out);
  if (files.length === 0) {
    console.log(`Usage: ${process.argv[0]} ${process.argv[1]} --out [config.csv] snap1.heapsnapshot.gz snap2.heapsnapshot.gz [more *.heapsnapshots.gz in order...]\n\nPrints out growing paths in the heap over several snapshots.`);
    process.exit();
  }
  const t = new HeapGrowthTracker();
  let i = 0;
  const data = new Map<string, { rs: number, tsc: number, owned: number }[]>();
  for (const file of files) {
    console.log(`Processing ${file}...`);
    await t.addSnapshot(getHeapSnapshotParser(file));
    if (i > 0) {
      const go = t.findLeakPaths();
      for (const obj of go) {
        const p = pathToString(obj.paths[0]);
        if (i === 1) {
          data.set(p, []);
        }
        const d = data.get(p);
        if (!d) {
          // Shouldn't happen...
          console.log(`??? Path ${p} missing???`);
        } else {
          d.push({ rs: obj.scores.retainedSize, tsc: obj.scores.transitiveClosureSize, owned: obj.scores.ownedObjects });
        }
      }
    }
    i++;
  }

  // OK, now to spit out information...
  const finalGo = t.findLeakPaths();
  out.write(`Path,"Round Trip",Metric,Value,Growing\n`);
  for (const obj of finalGo) {
    const p = pathToString(obj.paths[0]);
    const d = data.get(p);
    if (d) {
      let lastRS = Number.NEGATIVE_INFINITY;
      let lastTSC = Number.NEGATIVE_INFINITY;
      d.forEach((metrics, i) => {
        if (lastRS < metrics.rs) {
          lastRS = metrics.rs;
        } else {
          lastRS = Number.POSITIVE_INFINITY;
        }
        if (lastTSC < metrics.tsc) {
          lastTSC = metrics.tsc;
        } else {
          lastTSC = Number.POSITIVE_INFINITY;
        }
        out.write(`${p},${i},"Retained Size",${metrics.rs},${lastRS !== Number.POSITIVE_INFINITY}\n`);
        out.write(`${p},${i},"Transitive Closure Size",${metrics.tsc},${lastTSC !== Number.POSITIVE_INFINITY}\n`);
        out.write(`${p},${i},"Owned",${metrics.owned},"N/A"\n`);
      });
    }
  }
  out.end();
}

main();
