import {openSync, writeSync, readFileSync, existsSync, mkdirSync, createWriteStream} from 'fs';
import {join, dirname} from 'path';
import BLeak from '../lib/bleak';
import ChromeDriver from '../lib/chrome_driver';
import {createGzip} from 'zlib';
import * as yargs from 'yargs';

interface CommandLineArgs {
  out: string;
  config: string;
  snapshot: boolean;
  iterations: number;
  headless: boolean;
  'iterations-per-snapshot': number;
  'resume-iteration'?: number;
  'resume-metric'?: string;
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
  .boolean('headless')
  .default('headless', false)
  .describe('headless', `Run Chrome in headless mode (no GUI)`)
  .describe('snapshot', `Save snapshots into output folder`)
  .number('iterations')
  .describe('iterations', `Number of loop iterations to perform`)
  .demand('iterations')
  .number('iterations-per-snapshot')
  .describe('iterations-per-snapshot', 'Number of loop iterations per snapshot')
  .demand('iterations-per-snapshot')
  .number('resume-iteration')
  .describe('resume-iteration', 'Fix number to resume at.')
  .string('resume-metric')
  .describe('resume-metric', 'Metric to resume at')
  .help('help')
  .parse(process.argv);

if (!existsSync(args.out)) {
  mkdirSync(args.out);
}
if (args.snapshot) {
  if (!existsSync(join(args.out, 'snapshots'))) {
    mkdirSync(join(args.out, 'snapshots'));
  }
  if (!existsSync(join(args.out, 'snapshots', 'evaluation'))) {
    mkdirSync(join(args.out, 'snapshots', 'evaluation'));
  }
}

const outFile = openSync(join(args.out, 'impact.csv'), 'a');
function LOG(str: string): void {
  console.log(str);
  writeSync(outFile, str + "\n");
}

function mkdirp(s: string): void {
  if (!existsSync(s)) {
    const parent = dirname(s);
    mkdirp(parent);
    mkdirSync(s);
  }
}

async function main() {
  const configFileSource = readFileSync(args.config).toString();
  const chromeDriver = await ChromeDriver.Launch(<any> process.stdout, args.headless);
  let resumeAt: [number, string];
  if (args['resume-metric'] && typeof(args['resume-iteration']) === "number") {
    resumeAt = [args['resume-iteration'], args['resume-metric']];
  }
  await BLeak.EvaluateLeakFixes(configFileSource, chromeDriver, args.iterations, args['iterations-per-snapshot'], LOG, function(ss, metric, leaksFixed, iterationCount) {
    if (args.snapshot) {
      const outdir = join(args.out, 'snapshots', 'evaluation', metric, `${leaksFixed}`);
      mkdirp(outdir);
      const str = createGzip();
      str.pipe(createWriteStream(join(outdir, `s${iterationCount}.heapsnapshot.gz`)));
      ss.onSnapshotChunk = (chunk, end) => {
        str.write(chunk);
        if (end) {
          str.end();
        }
      };
    }
    return Promise.resolve();
  }, resumeAt);
}

main();
