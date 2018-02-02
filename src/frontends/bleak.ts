import {readFileSync, openSync, writeSync, closeSync, mkdirSync, existsSync, createWriteStream, writeFileSync} from 'fs';
import {join} from 'path';
import BLeak from '../lib/bleak';
import ChromeDriver from '../lib/chrome_driver';
import TextReporter from '../lib/text_reporter';
import * as yargs from 'yargs';
import {createGzip} from 'zlib';

interface CommandLineArgs {
  out: string;
  config: string;
  snapshot: boolean;
  headless: boolean;
}

const args: CommandLineArgs = <any> yargs.number('proxy-port')
  .usage("$0 [options] --out [directory] --config [config.js]")
  .string('out')
  .describe('out', `Directory to output leaks and source code to`)
  .demand('out')
  .string('config')
  .describe('config', `Configuration file to use with BLeak`)
  .demand('config')
  .boolean('snapshot')
  .default('snapshot', false)
  .describe('snapshot', `Save snapshots into output folder`)
  .boolean('headless')
  .default('headless', false)
  .describe('headless', `Run Chrome in headless mode (no GUI)`)
  .help('help')
  .parse(process.argv);

if (!existsSync(args.out)) {
  mkdirSync(args.out);
}
if (args.snapshot) {
  if (!existsSync(join(args.out, 'snapshots'))) {
    mkdirSync(join(args.out, 'snapshots'));
  }
  mkdirSync(join(args.out, 'snapshots', 'leak_detection'));
}

const outFile = openSync(join(args.out, 'leaks.log'), "w");
function LOG(str: string): void {
  console.log(str);
  writeSync(outFile, str + "\n");
}

async function main() {
  const configFileSource = readFileSync(args.config).toString();
  writeFileSync(join(args.out, 'config.js'), configFileSource);
  let chromeDriver = await ChromeDriver.Launch(<any> process.stdout, args.headless);
  // Add stack traces to Node warnings.
  // https://stackoverflow.com/a/38482688
  process.on('warning', (e: Error) => console.warn(e.stack));
  let shuttingDown = false;
  async function shutDown() {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    await chromeDriver.shutdown();
    // All sockets/subprocesses/resources *should* be closed, so we can just exit.
    process.exit(0);
  }
  // Shut down gracefully on CTRL+C.
  process.on('SIGINT', async function() {
    console.log(`CTRL+C received.`);
    shutDown();
  });
  let i = 0;
  const results = await BLeak.FindLeaks(configFileSource, chromeDriver, (sn) => {
    if (args.snapshot) {
      const str = createWriteStream(join(args.out, 'snapshots', 'leak_detection', `snapshot_${i}.heapsnapshot.gz`));
      i++;
      const gz = createGzip();
      gz.pipe(str);
      sn.onSnapshotChunk = function(chunk, end) {
        gz.write(chunk);
        if (end) {
          gz.end();
        }
      };
    }
    return Promise.resolve();
  });
  writeFileSync(join(args.out, 'bleak_results.json'), JSON.stringify(results, undefined, '  '));
  LOG(TextReporter(results));
  closeSync(outFile);
  console.log(`Results can be found in ${args.out}`);
  await shutDown();
}

main();