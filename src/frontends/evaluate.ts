import {openSync, writeSync, readFileSync} from 'fs';
import BLeak from '../lib/bleak';
import ChromeDriver from '../lib/chrome_driver';

const configFileName = process.argv[2];
const outFileName = process.argv[3];
const iterations = parseInt(process.argv[4], 10);
const iterations_per_snapshot = parseInt(process.argv[5], 10);
if (!configFileName || !outFileName || isNaN(iterations) || isNaN(iterations_per_snapshot)) {
  console.log(`Usage: ${process.argv[0]} ${process.argv[1]} config.js outfile.log iterations iterations_per_snapshot`);
  process.exit(0);
}

const outFile = openSync(outFileName, "w");
function LOG(str: string): void {
  console.log(str);
  writeSync(outFile, str + "\n");
}

async function main() {
  const configFileSource = readFileSync(configFileName).toString();
  const chromeDriver = await ChromeDriver.Launch(<any> process.stdout);
  BLeak.EvaluateLeakFixes(configFileSource, chromeDriver, iterations, iterations_per_snapshot, LOG);
}

main();
