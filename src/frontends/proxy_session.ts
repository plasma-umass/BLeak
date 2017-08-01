import Proxy from '../proxy/proxy';
import ChromeDriver from '../webdriver/chrome_driver';
import {proxyRewriteFunction} from '../lib/transformations';

const PROXY_PORT = 5554;
const CHROME_DRIVER_PORT = 4444;

const url = process.argv[2];
const diagnose = process.argv.indexOf('--diagnose');
if (diagnose !== -1) {
  process.argv.splice(diagnose, 1);
}
const fixes = process.argv.slice(3).map((f) => parseInt(f, 10));
if (!url) {
  console.log(`Usage: ${process.argv[0]} ${process.argv[1]} url [--diagnose] [fix1, fix2, ...]`);
  process.exit(0);
}

let proxyGlobal: Proxy = null;
let driverGlobal: ChromeDriver = null;
Proxy.listen(PROXY_PORT)
  .then((proxy) => {
    proxyGlobal = proxy;
    proxy.onRequest(proxyRewriteFunction(diagnose !== -1, "", fixes));
    return ChromeDriver.Launch(proxy, CHROME_DRIVER_PORT)
  })
  .then((driver) => {
    driverGlobal = driver;
    driver.navigateTo(url).then(() => driver.debug());
  });