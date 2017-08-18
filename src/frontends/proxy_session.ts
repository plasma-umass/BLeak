import ChromeRemoteDebuggingDriver from '../webdriver/chrome_remote_debugging_driver';
import {proxyRewriteFunction, evalRewriteFunction} from '../lib/transformations';


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

async function main() {
  const driver = await ChromeRemoteDebuggingDriver.Launch(<any> process.stdout);
  driver.onRequest(proxyRewriteFunction(diagnose !== -1, "", fixes))
  if (diagnose !== -1) {
    driver.onEval(evalRewriteFunction);
  }
  await driver.navigateTo(url);
  await driver.debugLoop();
  await driver.shutdown();
}

main();
