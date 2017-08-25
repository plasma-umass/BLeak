import {readFileSync, openSync, writeSync, closeSync, writeFileSync} from 'fs';
import {extname} from 'path';
import BLeak from '../lib/bleak';
import ChromeDriver from '../lib/chrome_driver';
import {Leak} from '../common/interfaces';
import {pathToString} from '../lib/growth_graph';

const configFileName = process.argv[2];
const outFileName = process.argv[3];
if (!configFileName || !outFileName) {
  console.log(`Usage: ${process.argv[0]} ${process.argv[1]} config.js outfile.log`);
  process.exit(0);
}

const outFile = openSync(outFileName, "w");
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
        LOG(`        [${j}] ${f.fileName}:${f.lineNumber}:${f.columnNumber}`);
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
  const configFileSource = readFileSync(configFileName).toString();
  let chromeDriver = await ChromeDriver.Launch(<any> process.stdout);
  const leaks = await BLeak.FindLeaks(configFileSource, chromeDriver);/*, (ss) => {
        const p = `${base}${i}.heapsnapshot`;
        console.log(`Writing ${p}...`);
        writeFileSync(p, Buffer.from(JSON.stringify(ss), 'utf8'));
        i++;
      });*/
    //.then((leaks) => Promise.all([proxyGlobal.shutdown(), driverGlobal.close()]).then(() => {
    //  clearInterval(interval);
    //  return leaks;
    //}))
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
    leaks.sort((a, b) => b.retainedSize - a.retainedSize).forEach((l, i) => {
      printLeak(l, "transitiveClosureSize", i);
    });
    LOG(``);
  }
  closeSync(outFile);
  console.log(`Leaks written to ${outFileName}`);
}

main();