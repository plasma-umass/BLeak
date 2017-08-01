"no transform";
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
  const r = /'/g;
  /**
   * Escapes single quotes in the given string.
   * @param s
   */
  function safeString(s: string): string {
    return s.replace(r, "\'");
  }

  /**
   * Creates a scope object.
   * @param parentScopeObject The scope object for the enclosing scope.
   * @param movedVariables Scope variables that have been "moved" to this object.
   * @param unmovedVariables Unmoved scope variables that are referenced from this object. Must be specified as getters/setters as this context does not have access to the unmoved variables.
   * @param args The name of the function's arguments.
   * @param argValues The values of the function's arguments.
   */
  function $$CREATE_SCOPE_OBJECT$$(parentScopeObject: Scope, movedVariables: string[], unmovedVariables: PropertyDescriptorMap, args: string[], argValues: any[]): Scope {
    movedVariables.concat(args).forEach((varName) => {
      unmovedVariables[varName] = {
        value: undefined,
        enumerable: true,
        writable: true,
        configurable: true
      };
    });

    // Initialize arguments.
    args.forEach((argName, i) => {
      unmovedVariables[argName].value = argValues[i];
    });

    return Object.create(parentScopeObject, unmovedVariables);
  }

  /**
   * Reimplementation of == such that Proxy(A) == A.
   * @param a
   * @param b
   */
  function $$$EQ$$$(a: any, b: any): boolean {
    if ($$$SEQ$$$(a, b)) {
      return true;
    } else {
      return a == b;
    }
  }

  /**
   * Reimplementation of === such that Proxy(A) === A.
   * @param a
   * @param b
   */
  function $$$SEQ$$$(a: any, b: any): boolean {
    if (a === b) {
      return true;
    } else if (isProxyable(a) && isProxyable(b)) {
      return (a.hasOwnProperty('$$$PROXY$$$') && a.$$$PROXY$$$ === b) ||
        (b.hasOwnProperty("$$$PROXY$$$") && b.$$$PROXY$$$ === a);
    }
    return false;
  }

  const fixSet = new Set<number>();
  function $$$SHOULDFIX$$$(n: number): boolean;
  function $$$SHOULDFIX$$$(n: number, value: boolean): void;
  function $$$SHOULDFIX$$$(n: number, value?: boolean): boolean | void {
    if (value !== undefined) {
      if (value) {
        fixSet.add(n);
      } else {
        fixSet.delete(n);
      }
    } else {
      return fixSet.has(n);
    }
  }

  /**
   * Returns whether or not value 'a' could harbor a proxy.
   * @param a
   */
  function isProxyable(a: any): boolean {
    switch (typeof(a)) {
      case "object":
      case "function":
        return a !== null && !(a instanceof Node);
      default:
        return false;
    }
  }

  /**
   * Get all of the possible root objects for the given path.
   * @param p
   */
  function getPossibleRoots(p: SerializeableGCPath): any[] {
    const root = p.root;
    switch (root.type) {
      case RootType.GLOBAL: {
        return [window];
      }
      case RootType.DOM: {
        const elementType = root.elementType;
        const rootObjs: any[] = [];
        if (elementType.startsWith("HTML") && elementType.endsWith("Element")) {
          const tag = elementType.slice(4, -7).toLowerCase();
          const elements = document.getElementsByTagName(tag);
          for (let i = 0; i < elements.length; i++) {
            rootObjs.push(elements[i]);
          }
        }
        return rootObjs;
      }
    }
  }

  /**
   * Returns an evaluateable JavaScript string to access the object at the given path
   * from a root.
   * @param p
   */
  function getAccessString(p: SerializeableGCPath, parent: boolean): string {
    let accessStr = "root";
    const path = p.path;
    const end = path[path.length - 1];
    for (const l of path) {
      if (parent && l === end) {
        if (l.type === EdgeType.CLOSURE) {
          return accessStr + `.__scope__`;
        } else {
          return accessStr;
        }
      }
      switch(l.type) {
        case EdgeType.CLOSURE:
          accessStr += `.__scope__['${l.indexOrName}']`;
          break;
        case EdgeType.INDEX:
        case EdgeType.NAMED:
          accessStr += `['${safeString(`${l.indexOrName}`)}']`;
          break;
      }
    }
    return accessStr;
  }


  const stackTraces = new Map<SerializeableGCPath, Map<string | number | symbol, Set<string>>>();
  function addStackTrace(map: Map<string | number | symbol, Set<string>>, property: string | number | symbol): void {
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
  }
  function removeStacks(map: Map<string | number | symbol, Set<string>>, property: string | number | symbol): void {
    if (map.has(property)) {
      map.delete(property);
    }
  }
  function copyStacks(map: Map<string | number | symbol, Set<string>>, from: string | number | symbol, to: string | number | symbol): void {
    if (map.has(from)) {
      map.set(to, map.get(from));
    }
  }
  function getProxy(accessStr: string, obj: any, map: Map<string | number | symbol, Set<string>>): any {
    if (!isProxyable(obj)) {
      console.log(`[PROXY ERROR]: Cannot create proxy for ${obj} at ${accessStr}.`);
      return obj;
    } else if (!obj.hasOwnProperty('$$$PROXY$$$')) {
      obj.$$$PROXY$$$ = new Proxy(obj, {
        defineProperty: function(target, property, descriptor): boolean {
          if (!disableProxies) {
            // Capture a stack trace.
            addStackTrace(map, property);
          }
          return Reflect.defineProperty(target, property, descriptor);
        },
        set: function(target, property, value, receiver): boolean {
          if (!disableProxies) {
            // Capture a stack trace.
            addStackTrace(map, property);
          }
          return Reflect.set(target, property, value, target);
        },
        get: function(target, property, receiver): any {
          if (property === secretStackMapProperty) {
            return map;
          } else if (property === secretIsProxyProperty) {
            return true;
          } else {
            return Reflect.get(target, property, target);
          }
        },
        deleteProperty: function(target, property): boolean {
          if (!disableProxies) {
            // Remove stack traces that set this property.
            removeStacks(map, property);
          }
          return Reflect.deleteProperty(target, property);
        }
      });
    }
    return obj.$$$PROXY$$$;
  }

  function updateMapForChangedProps(map: Map<string | number | symbol, Set<string>>, oldObj: Object, newObj: Object): void {
    if (!isProxyable(oldObj) || !isProxyable(newObj)) {
      return;
    }
    const oldProps = Object.keys(oldObj);
    const newProps = Object.keys(newObj);
    const oldPropSet = new Set(oldProps);
    const newPropSet = new Set(newProps);
    oldProps.forEach((prop) => {
      if (!newPropSet.has(prop)) {
        removeStacks(map, prop);
      }
    });
    newProps.forEach((prop) => {
      if (!oldPropSet.has(prop)) {
        addStackTrace(map, prop);
      }
    });

    if (newObj.hasOwnProperty("$$$PROXY$$$") && newObj.$$$PROXY$$$ !== oldObj.$$$PROXY$$$) {
      // Merge maps
      console.warn(`!!!! Need to support merging maps! !!!!`);
    }
  }

  function installProxy(accessStr: string, parentAccessStr: string, parent: any, obj: any, map: Map<string | number | symbol, Set<string>>, propName: string | number): void {
    let hiddenValue = getProxy(accessStr, obj, map);
    if ((typeof(parent) === "object" || typeof(parent) === "function") && parent !== null) {
      Object.defineProperty(parent, propName, {
        get: function() {
          return hiddenValue;
        },
        set: function(val) {
          hiddenValue = getProxy(accessStr, val, map);
          updateMapForChangedProps(map, obj, val);
          obj = val;
          return true;
        }
      });
    } else {
      console.log(`[PARENT FAILURE]: Unable to install getter on parent at ${parentAccessStr}.`);
    }
  }

  function replaceObjectsWithProxies(roots: any[], propName: string | number, accessStr: string, parentAccessStr: string, map: Map<string | number | symbol, Set<string>>): void {
    try {
      const getObjFcn: (root: any) => [any, any] = <any> new Function("root", `return [${parentAccessStr}, ${accessStr}];`);
      roots.map(getObjFcn).forEach((objs) => {
        installProxy(accessStr, parentAccessStr, objs[0], objs[1], map, propName);
      });
    } catch (e) {
      console.log(`[PROXY REPLACE ERROR] Failed to install proxy at ${accessStr}: ${e}`);
    }
  }

  const secretStackMapProperty = "$$$stackmap$$$";
  const secretIsProxyProperty = "$$$isproxy$$$";
  // Disables proxy interception.
  let disableProxies = false;
  function instrumentPath(paths: SerializeableGCPath[]): void {
    // Check if first path is in map. If not, all paths should not be in map.
    let map = stackTraces.get(paths[0]);
    if (!map) {
      map = new Map<string | number | symbol, Set<string>>();
      // Use shortest (0th) path as canonical path.
      stackTraces.set(paths[0], map);
    }
    // Fetch the objects.
    for (const p of paths) {
      const accessString = getAccessString(p, false);
      const parentAccessString = getAccessString(p, true);
      const roots = getPossibleRoots(p);
      if (p.path.length > 0) {
        replaceObjectsWithProxies(roots, p.path[p.path.length - 1].indexOrName, accessString, parentAccessString, map);
      }
    }
  }

  function instrumentPaths(p: SerializeableGCPath[][]): void {
    for (const path of p) {
      instrumentPath(path);
    }
  }

  function getStackTraces(): string {
    const rv: {[p: string]: string[]} = {};
    stackTraces.forEach((value, key) => {
      const stackSet = new Set<string>();
      value.forEach((stacks, prop) => {
        stacks.forEach((v) => {
          stackSet.add(v);
        });
      });
      const stackArray = new Array(stackSet.size);
      let i = 0;
      stackSet.forEach((s) => {
        stackArray[i++] = s;
      });
      rv[JSON.stringify(key)] = stackArray;
    });
    return JSON.stringify(rv);
  }

  // Global variables.
  const root = <Window> (typeof(window) !== "undefined" ? window : global);
  root.$$instrumentPaths = instrumentPaths;
  root.$$getStackTraces = getStackTraces;
  root.$$addStackTrace = addStackTrace;
  root.$$CREATE_SCOPE_OBJECT$$ = $$CREATE_SCOPE_OBJECT$$;
  root.$$$EQ$$$ = $$$EQ$$$;
  root.$$$SEQ$$$ = $$$SEQ$$$;
  root.$$$SHOULDFIX$$$ = $$$SHOULDFIX$$$;

  if (typeof(window) !== "undefined") {
    // Disable these in NodeJS.

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

    // Array modeling
    Array.prototype.push = (function(push) {
      return function(this: Array<any>, ...items: any[]): number {
        try {
          disableProxies = true;
          if ((<any> this)[secretIsProxyProperty]) {
            const map: Map<string | number | symbol,  Set<string>> = (<any> this)[secretStackMapProperty];
            for (let i = 0; i < items.length; i++) {
              addStackTrace(map, `${this.length + i}`);
            }
          }
          return push.apply(this, items);
        } finally {
          disableProxies = false;
        }
      };
    })(Array.prototype.push);

    Array.prototype.unshift = (function(unshift) {
      return function(this: Array<any>, ...items: any[]): number {
        try {
          disableProxies = true;
          if ((<any> this)[secretIsProxyProperty]) {
            const map: Map<string | number | symbol,  Set<string>> = (<any> this)[secretStackMapProperty];
            const newItemLen = items.length;
            for (let i = items.length - 1; i >= 0; i--) {
              copyStacks(map, `${i}`, `${i + newItemLen}`);
            }
            for (let i = 0; i < items.length; i++) {
              removeStacks(map, `${i}`);
              addStackTrace(map, `${i}`);
            }
          }
          return unshift.apply(this, items);
        } finally {
          disableProxies = false;
        }
      };
    })(Array.prototype.unshift);

    Array.prototype.pop = (function(pop) {
      return function(this: Array<any>): any {
        try {
          disableProxies = true;
          if ((<any> this)[secretIsProxyProperty]) {
            const map: Map<string | number | symbol,  Set<string>> = (<any> this)[secretStackMapProperty];
            removeStacks(map, `${this.length - 1}`);
          }
          return pop.apply(this);
        } finally {
          disableProxies = false;
        }
      };
    })(Array.prototype.pop);

    Array.prototype.shift = (function(shift) {
      return function(this: Array<any>): any {
        try {
          disableProxies = true;
          if ((<any> this)[secretIsProxyProperty]) {
            const map: Map<string | number | symbol,  Set<string>> = (<any> this)[secretStackMapProperty];
            removeStacks(map, "0");
            for (let i = 1; i < this.length; i++) {
              copyStacks(map, `${i}`, `${i - 1}`);
            }
            removeStacks(map, `${this.length - 1}`);
          }
          return shift.apply(this);
        } finally {
          disableProxies = false;
        }
      };
    })(Array.prototype.shift);

    Array.prototype.splice = (function(splice) {
      return function(this: Array<any>, start: number, deleteCount: number, ...items: any[]): any {
        try {
          disableProxies = true;
          if ((<any> this)[secretIsProxyProperty]) {
            const map: Map<string | number | symbol,  Set<string>> = (<any> this)[secretStackMapProperty];
            let actualStart = start | 0;
            if (actualStart === undefined) {
              return [];
            }
            // If greater than the length of the array, actual starting index will be set to the length of the array.
            if (actualStart > this.length) {
              actualStart = this.length;
            }
            // If negative, will begin that many elements from the end of the array (with origin 1)
            // and will be set to 0 if absolute value is greater than the length of the array.
            if (actualStart < 0) {
              actualStart = this.length + actualStart;
              if (actualStart < 0) {
                actualStart = 0;
              }
            }
            let actualDeleteCount = deleteCount | 0;
            // If deleteCount is omitted, or if its value is larger than array.length - start,
            //   then all of the elements beginning with start index on through the end of the array will be deleted.
            if (deleteCount === undefined || actualDeleteCount > this.length - actualStart) {
              actualDeleteCount = this.length - actualStart;
            }
            if (actualDeleteCount < 0) {
              actualDeleteCount = 0;
            }

            for (let i = 0; i < actualDeleteCount; i++) {
              const index = actualStart + i;
              removeStacks(map, `${index}`);
            }

            // Move existing traces into new locations.
            const newItemCount = items.length;
            if (newItemCount > actualDeleteCount) {
              // Shift *upward*
              const delta = newItemCount - actualDeleteCount;
              for (let i = this.length - 1; i >= actualStart + actualDeleteCount; i--) {
                copyStacks(map, `${i}`, `${i + delta}`);
              }
            } else if (newItemCount < actualDeleteCount) {
              // Shift *downward*
              const delta = newItemCount - actualDeleteCount;
              for (let i = actualStart + actualDeleteCount; i < this.length; i++) {
                copyStacks(map, `${i}`, `${i + delta}`);
              }
              // Delete extra traces for removed indexes.
              for (let i = this.length + delta; i < this.length; i++) {
                removeStacks(map, `${i}`);
              }
            }

            // Add new traces for new items.
            for (let i = 0; i < newItemCount; i++) {
              removeStacks(map, `${actualStart + i}`);
              addStackTrace(map, `${actualStart + i}`);
            }
          }
          return splice.apply(this, arguments);
        } finally {
          disableProxies = false;
        }
      };
    })(Array.prototype.splice);

    // TODO: Sort, reverse, ...

    // Deterministic Math.random(), so jQuery variable is deterministic.
    // From https://gist.github.com/mathiasbynens/5670917
    Math.random = (function() {
      let seed = 0x2F6E2B1;
      return function() {
        // Robert Jenkins’ 32 bit integer hash function
        seed = ((seed + 0x7ED55D16) + (seed << 12))  & 0xFFFFFFFF;
        seed = ((seed ^ 0xC761C23C) ^ (seed >>> 19)) & 0xFFFFFFFF;
        seed = ((seed + 0x165667B1) + (seed << 5))   & 0xFFFFFFFF;
        seed = ((seed + 0xD3A2646C) ^ (seed << 9))   & 0xFFFFFFFF;
        seed = ((seed + 0xFD7046C5) + (seed << 3))   & 0xFFFFFFFF;
        seed = ((seed ^ 0xB55A4F09) ^ (seed >>> 16)) & 0xFFFFFFFF;
        return (seed & 0xFFFFFFF) / 0x10000000;
      };
    }());
  }
})();