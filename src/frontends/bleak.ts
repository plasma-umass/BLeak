import {readFileSync, openSync, writeSync, closeSync} from 'fs';
import FindLeaks from '../lib/deuterium_oxide';
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

function path2string(p: SerializeableGCPath): string {
  let rv = "";
  switch (p.root.type) {
    case RootType.DOM:
      rv = `<${p.root.elementType}>`;
      break;
    case RootType.GLOBAL:
      rv = `window`;
      break;
  }
  const path = p.path;
  for (const l of path) {
    switch (l.type) {
      case EdgeType.CLOSURE:
        rv += `.__closure__(${l.indexOrName})`;
        break;
      case EdgeType.INDEX:
        rv += `['${l.indexOrName}']`;
        break;
      case EdgeType.NAMED:
        rv += `.${l.indexOrName}`;
        break;
    }
  }
  return rv;
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
    return FindLeaks(configFileSource, proxyGlobal, driver);
  })
  .then((leaks) => Promise.all([proxyGlobal.shutdown(), driverGlobal.close()]).then(() => leaks))
  .then((leaks) => {
  leaks.forEach((leak, i) => {
    const p: SerializeableGCPath = JSON.parse(leak.path);
    LOG(`Leak ${i+1}: ${path2string(p)}`);
    LOG(`  Properties:`);
    const newProps = leak.newProperties;
    for (const newPropName in newProps) {
      const stacks = newProps[newPropName];
      LOG(`    "${newPropName}", added by ${stacks.length} locations:`);
      stacks.forEach((stack, i) => {
        LOG(`      Stack ${i+1}:`);
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
    LOG(``);
  });
  closeSync(outFile);
  console.log(`Leaks written to ${outFileName}`);
}).catch((e) => {
  console.error("Failure!");
  console.error(e);
});

