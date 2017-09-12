import {openSync, writeSync, readFileSync, existsSync, mkdirSync, createWriteStream} from 'fs';
import {join} from 'path';
import BLeak from '../lib/bleak';
import ChromeDriver from '../lib/chrome_driver';
import * as yargs from 'yargs';

interface CommandLineArgs {
  out: string;
  config: string;
  snapshot: boolean;
  iterations: number;
  'iterations-per-snapshot': number;
}

const args: CommandLineArgs = <any> yargs.number('proxy-port')
  .usage("$0 --out [directory] --config [config.js] --iterations-per-snapshot [number] --iterations [number]")
  .string('out')
  .describe('out', `Directory to output leaks and source code to`)
  .demand('out')
  .string('config')
  .describe('config', `Configuration file to use with BLeak`)
  .demand('config')
  .boolean('snapshot')
  .default('snapshot', false)
  .describe('snapshot', `Save snapshots into output folder`)
  .number('iterations')
  .describe('iterations', `Number of loop iterations to perform`)
  .demand('iterations')
  .number('iterations-per-snapshot')
  .describe('iterations-per-snapshot', 'Number of loop iterations per snapshot')
  .demand('iterations-per-snapshot')
  .help('help')
  .parse(process.argv);

if (args.snapshot) {
  if (!existsSync(join(args.out, 'snapshots'))) {
    mkdirSync(join(args.out, 'snapshots'));
  }
  mkdirSync(join(args.out, 'snapshots', 'evaluation'));
}

const outFile = openSync(join(args.out, 'impact.csv'), "w");
function LOG(str: string): void {
  console.log(str);
  writeSync(outFile, str + "\n");
}

async function main() {
  const configFileSource = readFileSync(args.config).toString();
  const chromeDriver = await ChromeDriver.Launch(<any> process.stdout);
  const numberSnapsPerFix = Math.floor(args.iterations / args['iterations-per-snapshot']) + 1;
  let numFix = 0;
  let numSnaps = 0;
  BLeak.EvaluateLeakFixes(configFileSource, chromeDriver, args.iterations, args['iterations-per-snapshot'], LOG, function(ss) {
    if (args.snapshot) {
      if (numSnaps === 0) {
        mkdirSync(join(args.out, 'snapshots', 'evaluate', `${numFix}`));
      }
      const str = createWriteStream(join(args.out, 'snapshots', 'evaluation', `${numFix}`, `s${numSnaps}.heapsnapshot`));
      ss.onSnapshotChunk = (chunk, end) => {
        str.write(chunk);
        if (end) {
          str.end();
        }
      };
      numSnaps++;
      if (numSnaps >= numberSnapsPerFix) {
        numSnaps = 0;
        numFix++;
      }
    }
    return Promise.resolve();
  });
}

main();
