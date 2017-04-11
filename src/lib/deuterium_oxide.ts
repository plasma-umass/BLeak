import {injectIntoHead, exposeClosureState} from './transformations';

const AGENT_INJECT = `<script src="text/javascript" src="/understanding_agent.js"></script>`;

/**
 * Find leaks in an application.
 * @param configSource The source code of the configuration file, in UMD form.
 *   Should define global variable DeuteriumConfig.
 * @param proxy The proxy instance that relays connections from the webpage.
 * @param driver The application driver.
 */
export function FindLeaks(configSource: string, proxy: IProxy, driver: IBrowserDriver): Promise<Leak[]> {
  // TODO: Check shape of object, too.
  const CONFIG_INJECT = `<script src="text/javascript">${configSource}\nif (!window['DeuteriumConfig']) { console.error('Invalid configuration file: Global DeuteriumConfig object is not defined.'); }</script>`;
  return new Promise((resolve, reject) => {
    new Function(configSource)();
    const config: ConfigurationFile = (<any> global).DeuteriumConfig;
    const closureModifications: ClosureModification[] = [];

    proxy.onRequest((f) => {
      const mime = f.mimetype.toLowerCase();
      switch (mime) {
        case 'text/html':
          f.contents = injectIntoHead(f.contents, `${AGENT_INJECT}${CONFIG_INJECT}`);
          break;
        case 'text/javascript':
          f.contents = exposeClosureState(f.contents, closureModifications);
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

    //let tree = null;
    function processSnapshot(snapshot: HeapSnapshot): PromiseLike<void> {
      return null;
    }

    driver.navigateTo(config.url).then(() => {
      // Capture 5 heap snapshots.
      let promise = runLoop(true).then(processSnapshot);
      for (let i = 0; i < 4; i++) {
        promise = promise.then(() => runLoop(true).then(processSnapshot));
      }
      // Examine remaining heap items.
      // Instrument program repeatedly until we have a handle on stacks.

      return promise;
    }).catch(reject);
  });
}

export default FindLeaks;