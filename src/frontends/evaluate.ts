import {openSync, writeSync, readFileSync} from 'fs';
import BLeak from '../lib/bleak';
import Proxy from '../proxy/proxy';
import ChromeDriver from '../webdriver/chrome_driver';
const PROXY_PORT = 5554;
const CHROME_DRIVER_PORT = 4444;

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

let proxyGlobal: Proxy = null;
let driverGlobal: ChromeDriver = null;
const configFileSource = readFileSync(configFileName).toString();
Proxy.listen(PROXY_PORT)
  .then((proxy) => {
    proxyGlobal = proxy;
    return ChromeDriver.Launch(proxy, CHROME_DRIVER_PORT)
  })
  .then((driver) => {
    driverGlobal = driver;
    return BLeak.EvaluateLeakFixes(configFileSource, proxyGlobal, driverGlobal, LOG);
  });

