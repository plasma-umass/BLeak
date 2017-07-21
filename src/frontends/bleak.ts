import {readFileSync, openSync, writeSync, closeSync} from 'fs';
import FindLeaks from '../lib/deuterium_oxide';
import Proxy from '../proxy/proxy';
import ChromeDriver from '../webdriver/chrome_driver';
import {Leak} from '../common/interfaces';
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

/**
 * Print the given leak in the log.
 * @param l
 * @param metric
 * @param rank
 */
function printLeak(l: Leak, metric: string, rank: number): void {
  const obj = l.obj;
  const paths = obj.paths.map((p) => p.toJSON()).map(path2string);
  LOG(`## Object ${rank} [Score: ${l.rankMetrics[metric]}]`);
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
  if (leaks.length === 0) {
    LOG(`No leaks found.`);
  } else {
    const metrics = Object.keys(leaks[0].rankMetrics);
    metrics.forEach((m) => {
      LOG(`# Ranking Metric ${m}`);
      LOG(``);
      leaks.sort((a, b) => b.rankMetrics[m] - a.rankMetrics[m]).forEach((l, i) => {
        printLeak(l, m, i);
      });
      LOG(``);
    });
  }
  closeSync(outFile);
  console.log(`Leaks written to ${outFileName}`);
}).catch((e) => {
  console.error("Failure!");
  console.error(e);
});

