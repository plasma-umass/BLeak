import {readFileSync, mkdirSync, existsSync, createWriteStream, writeFileSync} from 'fs';
import {join} from 'path';
import BLeak from '../lib/bleak';
import ChromeDriver from '../lib/chrome_driver';
import TextReporter from '../lib/text_reporter';
import * as yargs from 'yargs';
import {createGzip} from 'zlib';
import ProgressProgressBar from '../lib/progress_progress_bar';

interface CommandLineArgs {
  out: string;
  config: string;
  snapshot: boolean;
  headless: boolean;
  debug: boolean;
  'take-screenshots': number;
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
  .boolean('debug')
  .default('debug', false)
  .describe('debug', 'Print debug information to console during run')
  .number('take-screenshots')
  .default('take-screenshots', -1)
  .describe('take-screenshots', `Take periodic screenshots every n seconds. Useful for debugging hung headless runs. -1 disables.`)
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
const SCREENSHOTS_DIR = join(args.out, 'screenshots');
if (args['take-screenshots'] !== -1) {
  if (!existsSync(SCREENSHOTS_DIR)) {
    mkdirSync(SCREENSHOTS_DIR);
  }
}

const progressBar = new ProgressProgressBar(args.debug);
// Add stack traces to Node warnings.
// https://stackoverflow.com/a/38482688
process.on('warning', (e: Error) => progressBar.error(e.stack));

async function main() {
  const configFileSource = readFileSync(args.config).toString();
  writeFileSync(join(args.out, 'config.js'), configFileSource);
  let chromeDriver = await ChromeDriver.Launch(progressBar, args.headless);

  let screenshotTimer: NodeJS.Timer | null = null;
  if (args['take-screenshots'] > -1) {
    screenshotTimer = setInterval(async function() {
      const time = Date.now();
      progressBar.debug(`Taking screenshot...`);
      const ss = await chromeDriver.takeScreenshot();
      const ssFilename = join(SCREENSHOTS_DIR, `screenshot_${time}.png`);
      progressBar.debug(`Writing ${ssFilename}...`);
      writeFileSync(ssFilename, ss);
    }, args['take-screenshots'] * 1000);
  }

  let shuttingDown = false;
  async function shutDown() {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    if (screenshotTimer) {
      clearInterval(screenshotTimer);
    }
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
  const results = await BLeak.FindLeaks(configFileSource, progressBar, chromeDriver, (sn) => {
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
  writeFileSync(join(args.out, 'bleak_results.json'), JSON.stringify(results));
  const resultsLog = TextReporter(results);
  writeFileSync(join(args.out, 'bleak_report.log'), resultsLog);
  console.log(resultsLog);
  console.log(`Results can be found in ${args.out}`);
  await shutDown();
}

main();