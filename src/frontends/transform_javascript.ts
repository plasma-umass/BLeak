import {readFileSync} from 'fs';
import {exposeClosureState, nopTransform} from '../lib/transformations';
import BLeakResults from '../lib/bleak_results';
import * as yargs from 'yargs';
import {extname, basename, join} from 'path';
import ProgressProgressBar from '../lib/progress_progress_bar';
import {existsSync, mkdirSync, writeFileSync} from 'fs';
import {URL} from 'url';

interface CommandLineArgs {
  in: string;
  out: string;
  overwrite: boolean;
  'nop-transform': boolean;
}

const args: CommandLineArgs = <any> yargs.number('proxy-port')
  .usage("$0 [options] --in bleak_results.json or file.js --out directory")
  .string('in')
  .describe('in', `Path to a BLeak configuration file, which contains source files to transform, or to an individual JavaScript file.`)
  .demand('in')
  .string('out')
  .demand('out')
  .describe('out', `Directory to dump output files to. Will be created if it does not exist.`)
  .boolean('overwrite')
  .default('overwrite', false)
  .describe('overwrite', `If true, overwrite files in the destination directory without prompting.`)
  .boolean('nop-transform')
  .default('nop-transform', false)
  .describe('nop-transform', `If true, BLeak does not transform the file, but appends a source map mapping the file to itself. Used for debugging BLeak's dependencies.`)
  .help('help')
  .parse(process.argv);

if (!existsSync(args.out)) {
  mkdirSync(args.out);
}

const flag = args.overwrite ? 'w' : 'wx';
const progressBar = new ProgressProgressBar(false);
function transformFile(from: string, src: string, to: string): void {
  progressBar.updateDescription(`Transforming ${from}...`)
  const transformed = args['nop-transform'] ? nopTransform(from, src) : exposeClosureState(from, src);
  progressBar.nextOperation();
  progressBar.updateDescription(`Writing ${from} to ${to}...`)
  writeFileSync(to, Buffer.from(transformed, 'utf8'), { flag });
  progressBar.nextOperation();
}


const data = readFileSync(args.in, 'utf8');
if (extname(args.in) === '.json') {
  const results = BLeakResults.FromJSON(JSON.parse(data));
  const urls = Object.keys(results.sourceFiles);
  progressBar.setOperationCount(urls.length * 2);
  urls.forEach((url) => {
    const urlObj = new URL(url);
    const out = join(args.out, basename(urlObj.pathname));
    if (results.sourceFiles[url].mimeType === 'text/html') {
      progressBar.log(`Tool currently does not support HTML documents; skipping ${url}.`);
      progressBar.nextOperation();
      progressBar.nextOperation();
    } else {
      transformFile(url, results.sourceFiles[url].source, out);
    }
  });
} else {
  progressBar.setOperationCount(2);
  const src = data.toString();
  const out = join(args.out, basename(args.in));
  transformFile(args.in, src, out);
}
