import {readFileSync} from 'fs';
import FindLeaks from '../lib/deuterium_oxide';
import Proxy from '../proxy/proxy';
import ChromeDriver from '../webdriver/chrome_driver';
const PROXY_PORT = 5554;
const CHROME_DRIVER_PORT = 4444;

const configFileName = process.argv[2];
if (!configFileName) {
  console.log(`Usage: ${process.argv[0]} ${process.argv[1]} config.js`);
  process.exit(0);
}

const configFileSource = readFileSync(configFileName).toString();
Proxy.listen(PROXY_PORT).then((proxy) => {
  return ChromeDriver.Launch(proxy, CHROME_DRIVER_PORT).then((driver) => {
    return FindLeaks(configFileSource, proxy, driver);
  });
}).then((leaks) => {
  leaks.forEach((leak, i) => {
    console.log(`Leak ${i+1}: ${leak.path}`);
    console.log(`  Properties:`);
    const newProps = leak.newProperties;
    for (const newPropName in newProps) {
      const stacks = newProps[newPropName];
      console.log(`    "${newPropName}", added by ${stacks.length} locations:`);
      stacks.forEach((stack, i) => {
        console.log(`      Stack ${i+1}:`);
        stack.forEach((f, j) => {
          if (j < 5) {
            console.log(`        [${j}] ${f.fileName}:${f.lineNumber}:${f.columnNumber}`);
          }
        });
        if (stack.length > 5) {
          console.log(`        (${stack.length - 5} more...)`);
        }
        console.log(``);
      });
      console.log(``);
    }
    console.log(``);
  });
}).catch((e) => {
  console.error("Failure!");
  console.error(e);
});

