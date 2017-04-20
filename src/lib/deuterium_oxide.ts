import {injectIntoHead, exposeClosureState} from './transformations';
import {IProxy, IBrowserDriver, Leak, ConfigurationFile, ClosureModification, HeapSnapshot, ClosurePath} from '../common/interfaces';
import HeapGrowthTracker from './growth_tracker';
import {GrowthPath} from './growth_graph';

const AGENT_INJECT = `<script src="text/javascript" src="/deuterium_agent.js"></script>`;

/**
 * Find leaks in an application.
 * @param configSource The source code of the configuration file, in UMD form.
 *   Should define global variable DeuteriumConfig.
 * @param proxy The proxy instance that relays connections from the webpage.
 * @param driver The application driver.
 */
export function FindLeaks(configSource: string, proxy: IProxy, driver: IBrowserDriver): Promise<Leak[]> {
  // TODO: Check shape of object, too.
  const CONFIG_INJECT = `
<script src="text/javascript">${configSource}
if (!window['DeuteriumConfig']) {
  console.error('Invalid configuration file: Global DeuteriumConfig object is not defined.');
}
</script>`;
  return new Promise((resolve, reject) => {
    new Function(configSource)();
    const config: ConfigurationFile = (<any> global).DeuteriumConfig;
    const closureModifications: ClosureModification[] = [];
    // function source => modification
    const closureModificationMap = new Map<string, ClosureModification>();

    /**
     * Get the function string using the given closure path.
     * @param p
     */
    function getFunctionString(p: ClosurePath): PromiseLike<string> {
      return driver.runCode(`(function() { var rv = null; try { rv = ${p.path}.toString(); } catch (e) {} return rv; })()`);
    }

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
    function getGrowthStacks(): PromiseLike<{[p: string]: {[prop: string]: string[]}}> {
      return driver.runCode(`window.$$getStackTraces()`).then((data) => JSON.parse(data));
    }

    driver.navigateTo(config.url).then(() => {
      // Capture 5 heap snapshots.
      let promise = runLoop(true).then(processSnapshot);
      for (let i = 0; i < 4; i++) {
        promise = promise.then(() => runLoop(true).then(processSnapshot));
      }
      // Instrument growing paths.
      promise = promise.then(() => {
        growthPaths = growthTracker.getGrowthPaths();
        // No more need for the growth tracker!
        growthTracker = null;
        let depth = 0;
        let closurePaths = growthPaths.map((p) => {
          const cp = p.getClosurePaths();
          if (cp.length > depth) {
            depth = cp.length;
          }
          // DEBUG.
          cp.forEach((p, i) => {
            console.log(`Closure path ${i}: ${p.path} [${p.variables.join(", ")}]`);
          })
          return cp;
        });

        // Combine equivalent closures in same round.
        let closurePathRounds: ClosurePath[][] = [];
        // path -> ClosurePath
        let pathMap = new Map<string, ClosurePath>();
        for (let i = 0; i < depth; i++) {
          let round: ClosurePath[] = [];
          for (const paths of closurePaths) {
            if (paths.length > i) {
              const path = paths[i];
              if (pathMap.has(path.path)) {
                // Merge variables.
                const existingPath = pathMap.get(path.path);
                for (const v in path.variables) {
                  if (existingPath.variables.indexOf(v) === -1) {
                    existingPath.variables.push(v);
                  }
                }
              } else {
                // New path.
                round.push(path);
                pathMap.set(path.path, path);
              }
            }
          }
          closurePathRounds.push(round);
        }

        let rv = Promise.resolve();
        // Each promise instruments one round deeper.
        closurePathRounds.forEach((round) => {
          // Run a single loop from the beginning of the execution before instrumenting.
          rv = rv.then(() => driver.navigateTo(config.url))
            .then(() => runLoop(false))
            .then(() => {
              // Get the function source for all paths in round,
              // and add them to closure modifications.
              return Promise.all(round.map((p) => {
                return getFunctionString(p).then((fStr) => {
                  if (fStr.indexOf("function") !== -1) {
                    const mod = closureModificationMap.get(fStr);
                    if (!mod) {
                      let mod = {
                        source: fStr,
                        variables: p.variables
                      };
                      closureModifications.push(mod);
                      closureModificationMap.set(fStr, mod);
                    } else {
                      // Merge variables.
                      for (const v of p.variables) {
                        if (mod.variables.indexOf(v) === -1) {
                          mod.variables.push(v);
                        }
                      }
                    }
                  }
                });
              }));
            });
        });
        return rv;
      }).then(() => {
        // We now have all needed closure modifications ready.
        // Run once.
        return driver.navigateTo(config.url)
          .then(() => runLoop(false))
          .then(() => {
            // Instrument objects to push information to global array.
            return instrumentGrowthPaths(growthPaths);
          })
          .then(() => runLoop(false))
          .then(() => {
            // Fetch array as string.
            const growthStacks = getGrowthStacks();
          });
      });

      return promise;
    }).catch(reject);
  });
}

// Need communication path from webpage -> proxy in the shim.
// proxy.onmessage.

export default FindLeaks;