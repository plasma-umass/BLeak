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
  const r = /'/g;
  /**
   * Escapes single quotes in the given string.
   * @param s
   */
  function safeString(s: string): string {
    return s.replace(r, "\'");
  }

  function getOrSetObjectsForPath(get: boolean, p: SerializeableGCPath, proxies?: Map<any, any>): any[][] {
    let accessStr = "root";
    const root = p.root;
    let rootObjs: any[] = [];
    switch (root.type) {
      case RootType.DOM: {
        const elementType = root.elementType;
        if (elementType.startsWith("HTML") && elementType.endsWith("Element")) {
          const tag = elementType.slice(4, -7).toLowerCase();
          const elements = document.getElementsByTagName(tag);
          for (let i = 0; i < elements.length; i++) {
            rootObjs.push(elements[i]);
          }
        }
        break;
      }
      case RootType.GLOBAL:
        rootObjs.push(window);
        break;
    }
    const path = p.path;
    const lastEdge = path[path.length - 1];
    for (const l of path) {
      switch(l.type) {
        case EdgeType.CLOSURE:
          if (!get && l === lastEdge) {
            accessStr += `.__closureAssign__('${safeString(`${l.indexOrName}`)}', proxy)`;
          } else {
            accessStr += `.__closure__('${safeString(`${l.indexOrName}`)}')`;
          }
          break;
        case EdgeType.INDEX:
        case EdgeType.NAMED:
          accessStr += `['${safeString(`${l.indexOrName}`)}']`;
          if (!get && l === lastEdge) {
            accessStr += ` = proxy`;
          }
          break;
      }
    }
    if (get) {
      return rootObjs.map((root) => {
        "use strict";
        try {
          return [root, new Function("root", `return ${accessStr};`)(root)];
        } catch (e) {
          console.error(e);
          return null;
        }
      }).filter((o) => o !== null);
    } else {
      rootObjs.forEach((root, i) => {
        "use strict";
        if (proxies.has(root)) {
          try {
            new Function("root", "proxy", `${accessStr};`)(root, proxies.get(root));
          } catch (e) {
            console.error(e);
          }
        }
      });
      return null;
    }
  }

  function setObjectsForPath(p: SerializeableGCPath, proxies: Map<any, any>): void {
    getOrSetObjectsForPath(false, p, proxies);
  }

  function getObjectsForPath(p: SerializeableGCPath): any[][] {
    return getOrSetObjectsForPath(true, p);
  }

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

  // Array of GC paths.
  // All should point to same object.
  //

  const stackTraces = new Map<SerializeableGCPath, Map<string | number | symbol, Set<string>>>();
  function instrumentPath(p: SerializeableGCPath[]): void {
    // Fetch the object.
    const objs = [].concat(...p.map((p) => getObjectsForPath(p)));
    // Check if first path is in map. If not, all paths should not be in map.
    let map = stackTraces.get(p[0]);
    if (!map) {
      map = new Map<string | number | symbol, Set<string>>();
      // Use shortest (0th) path as canonical path.
      stackTraces.set(p[0], map);
    }
    const proxies = new Map<any, any>();
    const proxiesByObject = new Map<any, any>();
    for (const objSet of objs) {
      // Ensure we use same proxy for same object.
      let finishedProxy = proxiesByObject.get(objSet[1]);
      if (!finishedProxy) {
        finishedProxy = new Proxy(objSet[1], {
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
        proxiesByObject.set(objSet[1], finishedProxy);
      }
      proxies.set(objSet[0], finishedProxy);
    }
    // Install proxies in the place of the roots.
    p.forEach((p) => setObjectsForPath(p, proxies));
  }

  function instrumentPaths(p: SerializeableGCPath[][]): void {
    for (const path of p) {
      instrumentPath(path);
    }
  }

  function getStackTraces(): string {
    const rv: {[p: string]: {[prop: string]: string[]}} = {};
    stackTraces.forEach((value, key) => {
      const map: {[prop: string]: string[]} = rv[JSON.stringify(key)] = {};
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

  window.$$instrumentPaths = instrumentPaths;
  window.$$getStackTraces = getStackTraces;
})();