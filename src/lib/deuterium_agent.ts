interface ListenerInfo {
  useCapture: boolean;
  listener: EventListenerOrEventListenerObject;
}

interface EventTarget {
  $$listeners?: {[type: string]: ListenerInfo[]};
}

/**
 * Agent injected into the webpage to surface browser-hidden leaks at the JS level.
 */
(function() {
  const addEventListener = EventTarget.prototype.addEventListener;
  const removeEventListener = EventTarget.prototype.removeEventListener;

  EventTarget.prototype.addEventListener = function(this: EventTarget, type: string, listener: EventListenerOrEventListenerObject, useCapture: boolean = false) {
    addEventListener.apply(this, arguments);
    if (!this.$$listeners) {
      this.$$listeners = {};
    }
    let listeners = this.$$listeners[type];
    if (!listeners) {
      listeners = this.$$listeners[type] = [];
    }
    for (const listenerInfo of listeners) {
      if (listenerInfo.listener === listener && listenerInfo.useCapture === useCapture) {
        return;
      }
    }
    listeners.push({
      listener: listener,
      useCapture: useCapture
    });
  };

  EventTarget.prototype.removeEventListener = function(this: EventTarget, type: string, listener: EventListenerOrEventListenerObject, useCapture: boolean = false) {
    removeEventListener.apply(this, arguments);
    if (this.$$listeners) {
      const listeners = this.$$listeners[type];
      if (listeners) {
        for (let i = 0; i < listeners.length; i++) {
          const lInfo = listeners[i];
          if (lInfo.listener === listener && lInfo.useCapture === useCapture) {
            listeners.splice(i, 1);
            if (listeners.length === 0) {
              delete this.$$listeners[type];
            }
            return;
          }
        }
      }
    }
  };

  const stackTraces = new Map<string, Map<string | number | symbol, Set<string>>>();
  function instrumentPath(p: string): void {
    try {
      // Fetch the object.
      const obj = new Function(`return ${p};`)();
      let map = stackTraces.get(p);
      if (!map) {
        map = new Map<string | number | symbol, Set<string>>();
        stackTraces.set(p, map);
      }
      // Make a proxy object to replace it.
      const proxy = new Proxy(obj, {
        defineProperty: function(target, property, descriptor): boolean {
          // Capture a stack trace.
          try {
            throw new Error();
          } catch (e) {
            let set = map.get(property);
            if (!set) {
              set = new Set<string>();
              map.set(property, set);
            }
            set.add(e.stack);
          }
          return Reflect.defineProperty(target, property, descriptor);
        },
        set: function(target, property, value, receiver): boolean {
          // Capture a stack trace.
          try {
            throw new Error();
          } catch (e) {
            let set = map.get(property);
            if (!set) {
              set = new Set<string>();
              map.set(property, set);
            }
            set.add(e.stack);
          }
          return Reflect.set(target, property, value, receiver);
        },
        deleteProperty: function(target, property): boolean {
          // Remove stack traces that set this property.
          if (map.has(property)) {
            map.delete(property);
          }
          return Reflect.deleteProperty(target, property);
        }
      });
      // Install proxy in its place.
      new Function(`${p} = proxy;`, 'proxy')(proxy);
    } catch (e) {
      console.log(`${p} not found, ignoring.`);
    }
  }

  function instrumentPaths(p: string[]): void {
    for (const path of p) {
      instrumentPath(path);
    }
  }

  function getStackTraces(): string {
    const rv: {[p: string]: {[prop: string]: string[]}} = {};
    stackTraces.forEach((value, key) => {
      const map: {[prop: string]: string[]} = rv[key] = {};
      value.forEach((stacks, prop) => {
        const stackArray = new Array<string>(stacks.size);
        let i = 0;
        stacks.forEach((v) => {
          stackArray[i] = v;
          i++;
        });
        map[prop] = stackArray;
      });
    });
    return JSON.stringify(rv);
  }

  (<any> window)['$$instrumentPaths'] = instrumentPaths;
  (<any> window)['$$getStackTraces'] = getStackTraces;
})();