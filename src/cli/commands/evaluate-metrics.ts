import {CommandModule} from 'yargs';
import BLeak from '../../lib/bleak';
import ChromeDriver from '../../lib/chrome_driver';
import ProgressProgressBar from '../../lib/progress_progress_bar';
import {readFileSync, writeFileSync} from 'fs';
import BLeakResults from '../../lib/bleak_results';

interface CommandLineArgs {
  config: string;
  results: string;
  debug: boolean;
  headless: boolean;
  chromeSize: string;
}

const EvaluateMetrics: CommandModule = {
  command: 'evaluate-metrics',
  describe: 'Evaluates the performance of different leak ranking metrics.',
  builder: {
    config: {
      type: 'string',
      demand: true,
      describe: 'Path to a BLeak configuration file. Must contain a fixMap property.'
    },
    results: {
      type: 'string',
      demand: true,
      describe: 'Path to a bleak_results.json from a completed run.'
    },
    debug: {
      type: 'boolean',
      default: false,
      describe: 'If set, print debug information to console.'
    },
    headless: {
      type: 'boolean',
      default: false,
      describe: 'Run in Chrome Headless (currently buggy)'
    },
    chromeSize: {
      type: 'string',
      default: '1920x1080',
      describe: 'Specifies the size of the Chrome browser window'
    }
  },
  handler: async (args: CommandLineArgs) => {
    let width: number, height: number;
    {
      const chromeSize = /^([0-9]+)x([0-9]+)$/.exec(args.chromeSize);
      if (!chromeSize) {
        throw new Error(`Invalid chromeSize: ${args.chromeSize}`);
      }
      width = parseInt(chromeSize[1], 10);
      height = parseInt(chromeSize[2], 10);
    }
    const progressBar = new ProgressProgressBar(args.debug);
    const chromeDriver = await ChromeDriver.Launch(progressBar, args.headless, width, height);
    const configFileSource = readFileSync(args.config).toString();
    const results = BLeakResults.FromJSON(JSON.parse(readFileSync(args.results, 'utf8')));

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
      progressBar.log(`CTRL+C received.`);
      shutDown();
    });

    BLeak.EvaluateRankingMetrics(configFileSource, progressBar, chromeDriver, results, (results) => {
      writeFileSync(args.results, Buffer.from(JSON.stringify(results), 'utf8'));
    }).then(shutDown).catch((e) => {
      progressBar.error(`${e}`);
      shutDown();
    });
  }
};

export default EvaluateMetrics;
