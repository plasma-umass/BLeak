import {readFileSync, openSync, writeSync, closeSync, mkdirSync, existsSync, createWriteStream, writeFileSync} from 'fs';
import {join} from 'path';
import BLeak from '../lib/bleak';
import ChromeDriver from '../lib/chrome_driver';
import {Leak, LeakJSON} from '../common/interfaces';
import {pathToString} from '../lib/growth_graph';
import * as yargs from 'yargs';
import {createGzip} from 'zlib';
import {parse as parseURL} from 'url';

interface CommandLineArgs {
  out: string;
  config: string;
  snapshot: boolean;
}

function makeNameSafe(name: string): string {
  return name.replace(/[\/:]/g, '_');
}

const args: CommandLineArgs = <any> yargs.number('proxy-port')
  .usage("$0 --out [directory] --config [config.js]")
  .string('out')
  .describe('out', `Directory to output leaks and source code to`)
  .demand('out')
  .string('config')
  .describe('config', `Configuration file to use with BLeak`)
  .demand('config')
  .boolean('snapshot')
  .default('snapshot', false)
  .describe('snapshot', `Save snapshots into output folder`)
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
mkdirSync(join(args.out, 'source'));

const outFile = openSync(join(args.out, 'leaks.log'), "w");
function LOG(str: string): void {
  console.log(str);
  writeSync(outFile, str + "\n");
}

/**
 * Print the given leak in the log.
 * @param l
 * @param metric
 * @param rank
 */
function printLeak(l: Leak, metric: "retainedSize" | "adjustedRetainedSize" | "transitiveClosureSize", rank: number): void {
  const paths = l.paths.map(pathToString);
  LOG(`## Object ${rank} [Score: ${l[metric]}]`);
  LOG(``);
  LOG(`### GC Paths`);
  LOG(``);
  LOG(`* ` + paths.join('\n* '));
  LOG(``);
  LOG(`### Stack Traces Responsible`);
  LOG(``);
  l.stacks.forEach((stack, i) => {
    LOG(``);
    stack.forEach((f, j) => {
      if (j < 10) {
        LOG(`        [${j}] ${f.functionName} ${f.fileName}:${f.lineNumber}:${f.columnNumber}`);
      }
    });
    if (stack.length > 10) {
      LOG(`        (${stack.length - 10} more...)`);
    }
    LOG(``);
  });
  LOG(``);
}

async function main() {
  const configFileSource = readFileSync(args.config).toString();
  writeFileSync(join(args.out, 'config.js'), configFileSource);
  let chromeDriver = await ChromeDriver.Launch(<any> process.stdout);
  // Add stack traces to Node warnings.
  // https://stackoverflow.com/a/38482688
  process.on('warning', (e: Error) => console.warn(e.stack));
  let shuttingDown = false;
  // Shut down gracefully on CTRL+C.
  process.on('SIGINT', async function() {
    if (shuttingDown) {
      return;
    }
    console.log(`Shutting down!`);
    shuttingDown = true;
    await chromeDriver.shutdown();
  });
  let i = 0;
  const leaks = await BLeak.FindLeaks(configFileSource, chromeDriver, (sn) => {
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
  if (leaks.length === 0) {
    LOG(`No leaks found.`);
  } else {
    LOG(`# Ranking Metric Adjusted Retained Size`);
    LOG(``);
    leaks.sort((a, b) => b.adjustedRetainedSize - a.adjustedRetainedSize).forEach((l, i) => {
      printLeak(l, "adjustedRetainedSize", i);
    });
    LOG(``);
    LOG(`# Ranking Metric Retained Size`);
    LOG(``);
    leaks.sort((a, b) => b.retainedSize - a.retainedSize).forEach((l, i) => {
      printLeak(l, "retainedSize", i);
    });
    LOG(``);
    LOG(`# Ranking Metric Transitive Closure`);
    LOG(``);
    leaks.sort((a, b) => b.transitiveClosureSize - a.transitiveClosureSize).forEach((l, i) => {
      printLeak(l, "transitiveClosureSize", i);
    });
    LOG(``);

    const leakJson: LeakJSON = {
      leaks: leaks.map((l) => {
        return {
          paths: l.paths.map(pathToString),
          scores: {
            transitive_closure: l.transitiveClosureSize,
            leak_growth: l.adjustedRetainedSize,
            retained_size: l.retainedSize
          },
          stacks: l.stacks.map((stack) => {
            return stack.map((frame) => {
              return {
                columnNumber: frame.columnNumber,
                lineNumber: frame.lineNumber,
                fileName: frame.fileName,
                functionName: frame.functionName,
                source: frame.source
              };
            });
          })
        };
      })
    };
    writeFileSync(join(args.out, 'leaks.json'), JSON.stringify(leakJson, undefined, '  '));

    chromeDriver.mitmProxy.forEachStashItem((data, url) => {
      const u = parseURL(url);
      try {
        writeFileSync(join(args.out, 'source', makeNameSafe(u.pathname)), data.data);
      } catch (e) {
        console.warn(`Failed to write ${url}`);
        console.warn(e);
      }
    });
  }
  closeSync(outFile);
  console.log(`Results can be found in ${args.out}`);
}

main();