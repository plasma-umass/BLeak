import {remote as remoteBrowser, Client, Options as ClientOptions} from 'webdriverio';
import {ChildProcess, spawn} from 'child_process';
import {parse as parseURL} from 'url';
import {tmpdir} from 'os';
import {mkdir, exists, createWriteStream, unlink, openSync, closeSync} from 'fs';
import {join, basename, dirname} from 'path';
import * as extractZip from 'extract-zip';
import LocateJavaHome = require('locate-java-home');
import {IJavaHomeInfo, ILocateJavaHomeOptions} from 'locate-java-home/js/lib/interfaces';
import {promisify} from '../common/util';
import {get} from 'request';
import {createConnection, Socket} from 'net';
import {IProxy, IBrowserDriver, HeapSnapshot} from '../common/interfaces';

const driverDir = join(`${tmpdir()}`, 'deuterium-oxide');
const mkdirPromise = promisify(null, mkdir);
const extractZipPromise = promisify(null, extractZip);
const locateJavaHomePromise = promisify<IJavaHomeInfo[], ILocateJavaHomeOptions>(null, LocateJavaHome);
const LATEST_DRIVER_VERSION = '2.29';
const LATEST_SELENIUM_VERSION = '3.3';
const LATEST_SELENIUM_MINOR_VERSION = '1';
const SELENIUM_URL = `https://selenium-release.storage.googleapis.com/${LATEST_SELENIUM_VERSION}/selenium-server-standalone-${LATEST_SELENIUM_VERSION}.${LATEST_SELENIUM_MINOR_VERSION}.jar`;

function downloadFile(url: string, destDir: string): Promise<string> {
  let parsedUrl = parseURL(url);
  let dest = join(destDir, basename(parsedUrl.path));
  console.log(`Downloading ${url}...`);
  return new Promise<string>((res, rej) => {
    get(url)
      .on('error', (e) => {
        unlink(dest, () => rej(e));
      })
      .pipe(createWriteStream(dest))
      .on('finish', () => res(dest));
  });
}

function extractFile(zipPath: string): Promise<string> {
  let entries: string[] = [];
  return extractZipPromise(zipPath, {dir: dirname(zipPath), onEntry: (entry) => entries.push(entry)}).then(() => {
    if (entries.length !== 1) {
      throw new Error(`Expected ${zipPath} to have one file inside of it. Instead, it has ${entries.length}??`);
    }
    return entries[0];
  });
}

/**
 * Get the currently running OS and architecture in a form compatible with ChromeDriver URLs.
 */
function getPlatform(): string {
  switch (process.platform) {
    case 'darwin':
      return 'mac64';
    case 'win32':
      return 'win32';
    default:
      if (process.arch === 'x64') {
        return 'linux64';
      } else {
        return 'linux32';
      }
  }
}

function existsPromise(path: string): Promise<boolean> {
  return new Promise((res, rej) => {
    exists(path, res);
  });
}

function createIfNotExist(path: string): Promise<any> {
  return existsPromise(path).then((exists) => {
    if (!exists) {
      return mkdirPromise(path);
    }
    return undefined;
  });
}

function downloadIfNotExist(downloadDir: string, url: string, extract: boolean): Promise<string> {
  const destPath = join(downloadDir, basename(parseURL(url).path));
  return existsPromise(destPath).then((exists) => {
    if (!exists) {
      let rv = downloadFile(url, downloadDir);
      if (extract) {
        rv = rv.then(extractFile);
      }
      return rv;
    }
    if (extract) {
      const chromeDriverPath = join(downloadDir, 'chromedriver');
      return existsPromise(chromeDriverPath).then((exists) => {
        if (exists) {
          return chromeDriverPath;
        }
        throw new Error(`Chrome driver is downloaded, but cannot find ${chromeDriverPath}!`);
      });
    } else {
      return destPath;
    }
  });
}

function waitForPort(port: number, timeout: number): Promise<void> {
  return new Promise<void>((res, rej) => {
    let finished = false;
    const timer = setTimeout(function() {
      fail(new Error(`Port ${port} failed to open within ${timeout} ms.`));
    }, timeout);

    function fail(err: Error): void {
      if (!finished) {
        finished = true;
        clearTimeout(timer);
        socket.destroy();
        socket = null;
        rej(err);
      }
    }

    function success(): void {
      if (!finished) {
        finished = true;
        clearTimeout(timer);
        res();
      }
    }

    function retryConnect(): void {
      socket.destroy();
      socket = null;
      setTimeout(function() {
        if (!finished) {
          tryConnect();
        }
      }, 50);
    }

    let socket: Socket = null;
    function tryConnect(): void {
      socket = createConnection({
        port: port,
        host: 'localhost'
      }, function() {
        success();
      }).once('error', retryConnect);
    }
    tryConnect();
  });
}

/**
 * Return the URL to the ChromeDriver.
 */
function getChromeDriverURL(): string {
  return `https://chromedriver.storage.googleapis.com/${LATEST_DRIVER_VERSION}/chromedriver_${getPlatform()}.zip`;
}

export default class ChromeBrowserDriver implements IBrowserDriver {
  public static Launch(proxy: IProxy, port: number): PromiseLike<ChromeBrowserDriver> {
    return createIfNotExist(driverDir).then(() => {
        // Find Java Home, download Selenium, download ChromeDriver in parallel.
        return Promise.all<IJavaHomeInfo[], string, string>([
          locateJavaHomePromise({ version: '1.8'}),
          downloadIfNotExist(driverDir, SELENIUM_URL, false),
          downloadIfNotExist(driverDir, getChromeDriverURL(), true)
        ]).then((result: [IJavaHomeInfo[], string, string]) => {
          const [javaHomes, seleniumPath, chromeDriverPath] = result;
          if (javaHomes.length === 0) {
            throw new Error(`Could not find an installation of Java 8. Java 8 is required to use WebDriver with Chrome.`);
          }
          let rv = new ChromeBrowserDriver({}, javaHomes[0].executables.java, seleniumPath, chromeDriverPath, proxy, port);
          console.log("Waiting for Selenium server to start...");
          return waitForPort(port, 5000).then(() => {
            return rv._initializeSelenium();
          });
        });
    });
  }

  private _client: Client<any> = null;
  private _selenium: ChildProcess;
  private _proxy: IProxy;
  private _options: ClientOptions;
  private _closed = false;

  private constructor(options: ClientOptions, javaPath: string, seleniumPath: string, driverPath: string, proxy: IProxy, port: number) {
    this._proxy = proxy;
    console.log(driverPath);
    console.log(`${javaPath} -Dwebdriver.chrome.driver=${driverPath} -jar ${seleniumPath} -port ${port}`);
    // Workaround for https://github.com/webdriverio/webdriverio/issues/391#issuecomment-104068517
    // If you do not pipe stdout/stderr somewhere (and instead "ignore" it),
    // webdriver/selenium stops accepting commands / hangs after awhile.
    const seleniumOut = openSync('./selenium.log', 'w');
    this._selenium = spawn(javaPath, [`-Dwebdriver.chrome.driver=${driverPath}`, '-jar', seleniumPath, '-port', `${port}`], {
      // Change to "inherit" for debugging.
      stdio: ["ignore", seleniumOut, seleniumOut]
    });
    process.on('exit', () => {
      this.close();
      closeSync(seleniumOut);
    });
    const proxyCapability: ClientOptions = {
      port: port,
      desiredCapabilities: {
        browserName: 'chrome',
        proxy: {
          proxyType: 'manual',
          httpProxy: `${this._proxy.getHost()}:${this._proxy.getHTTPPort()}`,
          // TODO: SSL proxy.
          // sslProxy: `${proxy.getHost()}:${proxy.getHTTPSPort()}`
        }
      }
    };
    this._options = Object.assign(options, proxyCapability);
  }

  private _initializeSelenium(): PromiseLike<this> {
    this._client = remoteBrowser(this._options).init();
    return <any> this._client.then(() => this);
  }

  public navigateTo(url: string): PromiseLike<any> {
    return this._client.url(url).waitUntil(() => {
      return <Promise<boolean>> <any> this._client.execute('return document.readyState').then((result) => {
        return `${result.value}` === "complete";
      });
    });
  }
  public runCode(code: string): PromiseLike<string> {
    return <any> this._client.execute(`return ${code}`).then((result) => {
      console.log(code + " => " + result.value);
      return "" + result.value;
    });
  }
  public takeHeapSnapshot(): PromiseLike<HeapSnapshot> {
    return <any> this._client.execute(`:takeHeapSnapshot`).then((result) => {
      return result.value;
    });
  }

  public close(): PromiseLike<any> {
    if (!this._closed) {
      this._closed = true;
      return <any> this._client.end().then(() => {
        return new Promise((resolve, reject) => {
          this._selenium.on('exit', () => resolve());
          this._selenium.kill();
        });
      });
    }
    return Promise.resolve();
  }
}