import {injectIntoHead, exposeClosureState} from './transformations';
import {IProxy, IBrowserDriver, Leak, ConfigurationFile, HeapSnapshot} from '../common/interfaces';
import HeapGrowthTracker from './growth_tracker';
import {GrowthObject} from './growth_graph';
import {parse as parseURL} from 'url';
import {StackFrame} from 'error-stack-parser';
import StackFrameConverter from './stack_frame_converter';
import {readFileSync} from 'fs';

const AGENT_INJECT = `<script type="text/javascript">${readFileSync(require.resolve('./deuterium_agent'), 'utf8')}</script>`;

/**
 * Find leaks in an application.
 * @param configSource The source code of the configuration file, in UMD form.
 *   Should define global variable DeuteriumConfig.
 * @param proxy The proxy instance that relays connections from the webpage.
 * @param driver The application driver.
 */
export function FindLeaks(configSource: string, proxy: IProxy, driver: IBrowserDriver, snapshotCb: (sn: HeapSnapshot) => void = () => {}): PromiseLike<Leak[]> {
  // TODO: Check shape of object, too.
  const CONFIG_INJECT = `
<script type="text/javascript">
window.DeuteriumConfig = {};
(function(exports) {
  ${configSource}
})(window.DeuteriumConfig);
</script>`;
  const config: ConfigurationFile = <any> { iterations: 4 };
  new Function('exports', configSource)(config);

  let diagnosing = false;
  proxy.onRequest((f) => {
    let mime = f.mimetype.toLowerCase();
    if (mime.indexOf(";") !== -1) {
      mime = mime.slice(0, mime.indexOf(";"));
    }
    console.log(`${f.url}: ${mime}`);
    switch (mime) {
      case 'text/html':
        f.contents = injectIntoHead(f.contents, `${AGENT_INJECT}${CONFIG_INJECT}`);
        break;
      case 'text/javascript':
      case 'application/javascript':
        if (diagnosing) {
          const url = parseURL(f.url);
          console.log(`Rewriting ${f.url}...`);
          f.contents = exposeClosureState(url.path, f.contents, false);
        }
        break;
    }
    return f;
  });

  function wait(d: number): Promise<void> {
    return new Promise<void>((resolve) => {
      setTimeout(resolve, d);
    });
  }

  function takeSnapshot(): PromiseLike<HeapSnapshot> {
    return driver.takeHeapSnapshot().then((sn) => {
      try {
        snapshotCb(sn);
      } catch (e) {
        console.log(`Snapshot callback exception:`);
        console.log(e);
      }
      return sn;
    });
  }

  function waitUntilTrue(i: number, prop: string): PromiseLike<void> {
    return <any> driver.runCode(`DeuteriumConfig.${prop}[${i}].check()`).then((success) => {
      if (success !== "true") {
        return wait(1000).then(() => waitUntilTrue(i, prop));
      } else {
        return undefined;
      }
    });
  }

  function nextStep(i: number, prop: string): PromiseLike<string> {
    return waitUntilTrue(i, prop).then(() => {
      return driver.runCode(`DeuteriumConfig.${prop}[${i}].next()`);
    });
  }

  function runLoop(snapshotAtEnd: false, prop: string, isLoop: boolean): PromiseLike<string | void>;
  function runLoop(snapshotAtEnd: true, prop: string, isLoop: boolean): PromiseLike<HeapSnapshot>;
  function runLoop(snapshotAtEnd: boolean, prop: string, isLoop: boolean): PromiseLike<HeapSnapshot | string | void> {
    const numSteps: number = (<any> config)[prop].length;
    let promise: PromiseLike<string | void> = nextStep(0, prop);
    if (numSteps > 1) {
      for (let i = 1; i < numSteps; i++) {
        promise = promise.then(() => nextStep(i, prop));
      }
    }
    if (isLoop) {
      // Wait for loop to finish.
      promise = promise.then(() => waitUntilTrue(0, prop));
    }
    if (snapshotAtEnd) {
      return promise.then(takeSnapshot);
    }
    return promise;
  }

  let growthTracker = new HeapGrowthTracker();
  let growthObjects: GrowthObject[] = null;
  function processSnapshot(snapshot: HeapSnapshot): PromiseLike<void> {
    return new Promise<void>((res, rej) => {
      const start = Date.now();
      growthTracker.addSnapshot(snapshot);
      const end = Date.now();
      console.log(`Adding snapshot took ${(end-start) / 1000} seconds.`);
      res();
    });
  }

  /**
   * Instruments the objects at the growth paths so they record stack traces whenever they expand.
   * @param ps
   */
  function instrumentGrowingObjects(ps: GrowthObject[]): PromiseLike<any> {
    return driver.runCode(`window.$$instrumentPaths(${JSON.stringify(ps)})`);
  }

  /**
   * Returns all of the stack traces associated with growing objects.
   */
  function getGrowthStacks(): PromiseLike<{[p: string]: StackFrame[][]}> {
    return <any> driver.runCode(`window.$$getStackTraces()`).then((data) => JSON.parse(data)).then((data) => StackFrameConverter.ConvertGrowthStacks(proxy, data));
  }

  return driver.navigateTo(config.url).then(() => {
    // Capture 5 heap snapshots.
    let promise = (config.login ? runLoop(false, 'login', false).then(() => driver.navigateTo(config.url)) : Promise.resolve())
      .then(() => config.setup ? runLoop(false, 'setup', false) : Promise.resolve())
      .then(() => runLoop(true, 'loop', true)
      .then(processSnapshot));
    for (let i = 0; i < config.iterations; i++) {
      promise = promise.then(() => runLoop(true, 'loop', true).then(processSnapshot));
    }
    // Instrument growing paths.
    return promise.then(() => {
      console.log(`Calculating growing paths...`);
      const start = Date.now();
      growthObjects = growthTracker.getGrowingObjects();
      const end = Date.now();
      console.log(`Growing paths took ${(end - start) / 1000} s to process; number: ${growthObjects.length}`);
      console.log(`Growing paths:\n${growthObjects.map((gp) => JSON.stringify(gp)).join("\n")}`);
    }).then(() => {
      // We now have all needed closure modifications ready.
      // Run once.
      if (growthObjects.length > 0) {
        console.log("Going to diagnose now...");
        // Flip on JS instrumentation.
        diagnosing = true;
        return driver.navigateTo(config.url)
          .then(() => config.setup ? runLoop(false, 'setup', false) : Promise.resolve())
          .then(() => runLoop(false, 'loop', true))
          .then(() => {
            console.log("Instrumenting growth paths...");
            // Instrument objects to push information to global array.
            return instrumentGrowingObjects(growthObjects);
          })
          // Measure growth during two loops.
          .then(() => runLoop(false, 'loop', true))
          .then(() => runLoop(false, 'loop', true))
          .then(() => {
            // Fetch array as string.
            return getGrowthStacks().then((growthStacks) => {
              // console.log(`Got growth stacks:\n${JSON.stringify(growthStacks)}`);
              const rv: Leak[] = [];
              const lookup = new Map<string, GrowthObject>();
              const ranked = growthTracker.rankGrowingObjects(growthObjects);
              growthObjects.forEach((g) => lookup.set(g.key, g));
              for (const p in growthStacks) {
                const obj = lookup.get(p);
                const rm: {[m: string]: number} = {};
                ranked.get(obj).forEach((v) => rm[v[0]] = v[1]);
                rv.push({
                  obj: obj,
                  stacks: growthStacks[p],
                  rankMetrics: rm
                });
              }
              return rv;
            });
          });
      } else {
        console.log(`No growth objects found!`);
        return [];
      }
    });
  });
}

export default FindLeaks;