import {injectIntoHead, exposeClosureState} from './transformations';
import {IProxy, IBrowserDriver, Leak, ConfigurationFile, HeapSnapshot} from '../common/interfaces';
import HeapGrowthTracker from './growth_tracker';
import {GrowthPath} from './growth_graph';
import {parse as parseURL} from 'url';
import {StackFrame} from 'error-stack-parser';
import StackFrameConverter from './stack_frame_converter';

const AGENT_INJECT = `<script type="text/javascript" src="/deuterium_agent.js"></script>`;

/**
 * Find leaks in an application.
 * @param configSource The source code of the configuration file, in UMD form.
 *   Should define global variable DeuteriumConfig.
 * @param proxy The proxy instance that relays connections from the webpage.
 * @param driver The application driver.
 */
export function FindLeaks(configSource: string, proxy: IProxy, driver: IBrowserDriver): PromiseLike<Leak[]> {
  // TODO: Check shape of object, too.
  const CONFIG_INJECT = `
<script type="text/javascript">
window.DeuteriumConfig = {};
(function(exports) {
  ${configSource}
})(window.DeuteriumConfig);
</script>`;
  const config: ConfigurationFile = <any> {};
  new Function('exports', configSource)(config);

  let diagnosing = false;
  proxy.onRequest((f) => {
    const mime = f.mimetype.toLowerCase();
    switch (mime) {
      case 'text/html':
        f.contents = injectIntoHead(f.contents, `${AGENT_INJECT}${CONFIG_INJECT}`);
        break;
      case 'text/javascript':
        if (diagnosing) {
          const url = parseURL(f.url);
          f.contents = exposeClosureState(url.path, f.contents);
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
    return driver.takeHeapSnapshot();
  }

  function waitUntilTrue(i: number): PromiseLike<void> {
    return driver.runCode(`DeuteriumConfig.loop[${i}].check()`).then((success) => {
      if (!success) {
        return wait(1000).then(() => waitUntilTrue(i));
      } else {
        return undefined;
      }
    });
  }

  function nextStep(i: number): PromiseLike<string> {
    return waitUntilTrue(i).then(() => {
      return driver.runCode(`DeuteriumConfig.loop[${i}].next()`);
    });
  }

  function runLoop(snapshotAtEnd: false): PromiseLike<string>;
  function runLoop(snapshotAtEnd: true): PromiseLike<HeapSnapshot>;
  function runLoop(snapshotAtEnd: boolean): PromiseLike<HeapSnapshot | string> {
    const numSteps = config.loop.length;
    let promise = nextStep(0);
    if (numSteps > 1) {
      for (let i = 1; i < numSteps; i++) {
        promise = promise.then(() => nextStep(i));
      }
    }
    if (snapshotAtEnd) {
      return promise.then(takeSnapshot);
    }
    return promise;
  }

  let growthTracker = new HeapGrowthTracker();
  let growthPaths: GrowthPath[] = null;
  function processSnapshot(snapshot: HeapSnapshot): PromiseLike<void> {
    return new Promise<void>((res, rej) => {
      growthTracker.addSnapshot(snapshot);
      res();
    });
  }

  /**
   * Instruments the objects at the growth paths so they record stack traces whenever they expand.
   * @param ps
   */
  function instrumentGrowthPaths(ps: GrowthPath[]): PromiseLike<any> {
    return driver.runCode(`window.$$instrumentPaths(${JSON.stringify(ps.map((p) => p.getAccessString()))})`);
  }

  /**
   * Returns all of the stack traces associated with growing objects.
   */
  function getGrowthStacks(): PromiseLike<{[p: string]: {[prop: string]: StackFrame[][]}}> {
    return driver.runCode(`window.$$getStackTraces()`).then((data) => JSON.parse(data)).then((data) => StackFrameConverter.ConvertGrowthStacks(proxy, data));
  }

  return driver.navigateTo(config.url).then(() => {
    // Capture 5 heap snapshots.
    let promise = runLoop(true).then(processSnapshot);
    for (let i = 0; i < 4; i++) {
      promise = promise.then(() => runLoop(true).then(processSnapshot));
    }
    // Instrument growing paths.
    return promise.then(() => {
      growthPaths = growthTracker.getGrowthPaths();
      console.log(`Growing paths:\n${growthPaths.map((gp) => gp.getAccessString()).join("\n")}`);
      // No more need for the growth tracker!
      growthTracker = null;
    }).then(() => {
      // We now have all needed closure modifications ready.
      // Run once.
      if (growthPaths.length > 0) {
        console.log("Going to diagnose now...");
        // Flip on JS instrumentation.
        diagnosing = true;
        return driver.navigateTo(config.url)
          .then(() => runLoop(false))
          .then(() => {
            console.log("Instrumenting growth paths...");
            // Instrument objects to push information to global array.
            return instrumentGrowthPaths(growthPaths);
          })
          // Measure growth during one more loop.
          .then(() => runLoop(false))
          .then(() => {

            // Fetch array as string.
            return getGrowthStacks().then((growthStacks) => {
              // console.log(`Got growth stacks:\n${JSON.stringify(growthStacks)}`);
              const rv: Leak[] = [];
              for (const p in growthStacks) {
                rv.push({
                  path: p,
                  newProperties: growthStacks[p]
                });
              }
              return rv;
            });
          });
      } else {
        return undefined;
      }
    });
  });
}

export default FindLeaks;