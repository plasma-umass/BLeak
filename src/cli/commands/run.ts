import {readFileSync, mkdirSync, existsSync, createWriteStream, writeFileSync} from 'fs';
import {join} from 'path';
import BLeak from '../../lib/bleak';
import ChromeDriver from '../../lib/chrome_driver';
import TextReporter from '../../lib/text_reporter';
import {createGzip} from 'zlib';
import ProgressProgressBar from '../../lib/progress_progress_bar';
import {CommandModule} from 'yargs';
import {DEFAULT_AGENT_URL, DEFAULT_BABEL_POLYFILL_URL, DEFAULT_AGENT_TRANSFORM_URL} from '../../lib/mitmproxy_interceptor';
import BLeakResults from '../../lib/bleak_results';

interface CommandLineArgs {
  out: string;
  config: string;
  snapshot: boolean;
  headless: boolean;
  debug: boolean;
  'take-screenshots': number;
  chromeSize: string;
  'produce-time-log': boolean;
  'chrome-args': string[];
}

const Run: CommandModule = {
  command: "run",
  describe: `Runs BLeak to locate, rank, and diagnose memory leaks in a web application.`,
  handler: (args: CommandLineArgs) => {
    let width: number, height: number;
    {
      const chromeSize = /^([0-9]+)x([0-9]+)$/.exec(args.chromeSize);
      if (!chromeSize) {
        throw new Error(`Invalid chromeSize: ${args.chromeSize}`);
      }
      width = parseInt(chromeSize[1], 10);
      height = parseInt(chromeSize[2], 10);
    }
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

    const chromeArgs = args['chrome-args'].map((arg) => {
      return '--' + arg;
    });

    const progressBar = new ProgressProgressBar(args.debug, args['produce-time-log']);
    // Add stack traces to Node warnings.
    // https://stackoverflow.com/a/38482688
    process.on('warning', (e: Error) => progressBar.error(e.stack));

    let chromeDriver: ChromeDriver;
    let screenshotTimer: NodeJS.Timer | null = null;

    async function main() {
      const configFileSource = readFileSync(args.config).toString();
      console.log("=========== here 1")

      let shuttingDown = false;
      async function shutDown() {
        if (shuttingDown) {
          return;
        }
        shuttingDown = true;
        if (screenshotTimer) {
          clearInterval(screenshotTimer);
        }
        if (chromeDriver) {
          await chromeDriver.shutdown();
        }
        // All sockets/subprocesses/resources *should* be closed, so we can just exit.
        process.exit(0);
      }
      // Shut down gracefully on CTRL+C.
      process.on('SIGINT', async function() {
        console.log(`CTRL+C received.`);
        shutDown();
      });

      const bleakResultsOutput = join(args.out, 'bleak_results.json');
      let bleakResults: BLeakResults | null;
      if (existsSync(bleakResultsOutput)) {
        console.log(`Resuming using data from ${bleakResultsOutput}`);
        try {
          bleakResults = BLeakResults.FromJSON(JSON.parse(readFileSync(bleakResultsOutput).toString()));
        } catch (e) {
          throw new Error(`File at ${bleakResultsOutput} exists, but is not a valid BLeak results file: ${e}`);
        }
      }

      writeFileSync(join(args.out, 'config.js'), configFileSource);
      console.log("=========== here 2")

      chromeDriver = await ChromeDriver.Launch(progressBar, args.headless, width, height, ['/eval', DEFAULT_AGENT_URL, DEFAULT_BABEL_POLYFILL_URL, DEFAULT_AGENT_TRANSFORM_URL], !args.debug, chromeArgs);

      console.log("=========== here 3 ChromeDriver launched")

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

      let i = 0;
      BLeak.FindLeaks(configFileSource, progressBar, chromeDriver, (results) => {
        writeFileSync(bleakResultsOutput, JSON.stringify(results));
        const resultsLog = TextReporter(results);
        writeFileSync(join(args.out, 'bleak_report.log'), resultsLog);
      }, (sn) => {
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
      }, bleakResults).then((results) => {
        writeFileSync(bleakResultsOutput, JSON.stringify(results));
        const resultsLog = TextReporter(results);
        writeFileSync(join(args.out, 'bleak_report.log'), resultsLog);
        if (args['produce-time-log']) {
          writeFileSync(join(args.out, 'time_log.json'), JSON.stringify(progressBar.getTimeLog()));
        }
        console.log(`Results can be found in ${args.out}`);
        return shutDown();
      }).catch((e) => {
        progressBar.error(`${e}`);
        return shutDown();
      });
    }

    main();
  },
  builder: {
    out: {
      type: 'string',
      demand: true,
      describe: 'Directory to output leaks and source code to'
    },
    config: {
      type: 'string',
      demand: true,
      describe: 'Configuration file to use with BLeak'
    },
    snapshot: {
      type: 'boolean',
      default: false,
      describe: 'Save heap snapshots into output folder'
    },
    headless: {
      type: 'boolean',
      default: false,
      describe: `Run Chrome in headless mode (no GUI) (currently buggy due to Chrome bugs)`
    },
    debug: {
      type: 'boolean',
      default: false,
      describe: 'Print debug information to console during run'
    },
    'take-screenshots': {
      type: 'number',
      default: -1,
      describe: 'Take periodic screenshots every n seconds. Useful for debugging hung headless runs. -1 disables.'
    },
    chromeSize: {
      type: 'string',
      default: '1920x1080',
      describe: 'Specifies the size of the Chrome browser window'
    },
    'produce-time-log': {
      type: 'boolean',
      default: false,
      describe: '[DEBUG] If set, produces a JSON time log to measure BLeak\'s overhead.'
    },
    'chrome-args': {
      type: 'array',
      default: [],
      describe: 'Args that should be passed to chrome without the leading --. ex `no-sandbox`'
    }
  }
};

export default Run;
