"no transform";
interface ListenerInfo {
  useCapture: boolean;
  listener: EventListenerOrEventListenerObject;
}

interface EventTarget {
  $$listeners?: {[type: string]: ListenerInfo[]};
}

declare function importScripts(s: string): void;

/**
 * Agent injected into the webpage to surface browser-hidden leaks at the JS level.
 */
(function() {
  const r = /'/g;

  /**
   * Get a stack trace.
   */
  function _getStackTrace(): string {
    try {
      throw new Error();
    } catch (e) {
      return e.stack;
    }
  }

  /**
   * Escapes single quotes in the given string.
   * @param s
   */
  function safeString(s: string): string {
    return s.replace(r, "\\'");
  }

  /**
   * Creates a scope object.
   * @param parentScopeObject The scope object for the enclosing scope.
   * @param movedVariables Scope variables that have been "moved" to this object.
   * @param unmovedVariables Unmoved scope variables that are referenced from this object. Must be specified as getters/setters as this context does not have access to the unmoved variables.
   * @param args The name of the function's arguments.
   * @param argValues The values of the function's arguments.
   */
  function $$$CREATE_SCOPE_OBJECT$$$(parentScopeObject: Scope, movedVariables: string[], unmovedVariables: PropertyDescriptorMap, args: string[], argValues: any[]): Scope {
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
  /**
   * Checks that bug n should be fixed.
   * @param n Unique bug ID.
   */
  function $$$SHOULDFIX$$$(n: number): boolean;
  /**
   * Sets whether or not bug n should be fixed.
   * @param n Unique bug ID.
   * @param value If true, bug n should be fixed.
   */
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
   * Sends text passed to `eval` to the server for rewriting,
   * and then evaluates the new string.
   * @param scope The context in which eval was called.
   * @param text The JavaScript code to eval.
   */
  function $$$REWRITE_EVAL$$$(scope: any, source: string): any {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/eval', false);
    xhr.setRequestHeader("Content-type", "application/json");
    xhr.send(JSON.stringify({ scope: "scope", source }));
    return eval(xhr.responseText);
  }

  /**
   * Assigns the given scope to the given function object.
   * @param fcn
   * @param scope
   */
  function $$$FUNCTION_EXPRESSION$$$(fcn: Function, scope: Scope): Function {
    fcn.__scope__ = scope;
    return fcn;
  }

  /**
   * Returns whether or not value 'a' could harbor a proxy.
   * @param a
   */
  function isProxyable(a: any): boolean {
    switch (typeof(a)) {
      case "object":
      case "function":
        return a !== null; // && !(a instanceof Node);
      default:
        return false;
    }
  }

  /**
   * Represents an object's proxy status.
   */
  const enum ProxyStatus {
    // The object has a proxy, and is a proxy itself!
    IS_PROXY,
    // The object has a proxy, but is the original object
    HAS_PROXY,
    // The value is not a proxy, and does not have a proxy.
    // It may not even be an object.
    NO_PROXY
  }

  /**
   * Get the proxy status of the given value.
   * @param a
   */
  function getProxyStatus(a: any): ProxyStatus {
    if (isProxyable(a) && a.hasOwnProperty("$$$PROXY$$$")) {
      if (a.$$$PROXY$$$ === a) {
        return ProxyStatus.IS_PROXY;
      } else {
        return ProxyStatus.HAS_PROXY;
      }
    }
    return ProxyStatus.NO_PROXY;
  }

  /**
   * If `a` is a proxy, returns the original object.
   * Otherwise, returns `a` itself.
   * @param a
   */
  function unwrapIfProxy(a: any): any {
    switch (getProxyStatus(a)) {
      case ProxyStatus.IS_PROXY:
        return a.$$$ORIGINAL$$$;
      case ProxyStatus.HAS_PROXY:
      case ProxyStatus.NO_PROXY:
        return a;
    }
  }

  /**
   * If `a` has a proxy, returns the proxy. Otherwise, returns `a` itself.
   * @param a
   */
  function wrapIfOriginal(a: any): any {
    switch (getProxyStatus(a)) {
      case ProxyStatus.HAS_PROXY:
        return a.$$$PROXY$$$;
      case ProxyStatus.IS_PROXY:
      case ProxyStatus.NO_PROXY:
        return a;
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

  /**
   * Adds a stack trace to the given map for the given property.
   * @param map
   * @param property
   */
  function _addStackTrace(map: Map<string | number | symbol, Set<string>>, property: string | number | symbol, stack = _getStackTrace()): void {
    let set = map.get(property);
    if (!set) {
      set = new Set<string>();
      map.set(property, set);
    }
    set.add(stack);
  }
  /**
   * Removes stack traces for the given map for the given property.
   * @param map
   * @param property
   */
  function _removeStacks(map: Map<string | number | symbol, Set<string>>, property: string | number | symbol): void {
    if (map.has(property)) {
      map.delete(property);
    }
  }
  /**
   * Copy all of the stacks from `from` to `to` within the map.
   * @param map
   * @param from
   * @param to
   */
  function _copyStacks(map: Map<string | number | symbol, Set<string>>, from: string | number | symbol, to: string | number | symbol): void {
    if (map.has(from)) {
      map.set(to, map.get(from));
    }
  }

  /**
   * Initialize a map to contain stack traces for all of the properties of the given object.
   * @param map
   * @param obj
   */
  function _initializeMap(obj: any): Map<string | number | symbol, Set<string>> {
    const map = new Map<string | number | symbol, Set<string>>();
    const trace = _getStackTrace();
    Object.keys(obj).forEach((k) => {
      _addStackTrace(map, k, trace);
    });
    return map;
  }

  /**
   * Returns a proxy object for the given object, if applicable. Creates a new object if the object
   * is not already proxied.
   * @param accessStr
   * @param obj
   * @param map
   */
  function getProxy(accessStr: string, obj: any, initialInstallation = false): any {
    if (!isProxyable(obj)) {
      // console.log(`[PROXY ERROR]: Cannot create proxy for ${obj} at ${accessStr}.`);
      return obj;
    } else if (!obj.hasOwnProperty('$$$PROXY$$$')) {
      const map = initialInstallation ? new Map<string | number | symbol, Set<string>>() : _initializeMap(obj);
      Object.defineProperty(obj, '$$$ORIGINAL$$$', {
        value: obj,
        writable: false,
        enumerable: false,
        configurable: true
      });
      Object.defineProperty(obj, "$$$STACKTRACES$$$", {
        value: map,
        writable: false,
        enumerable: false,
        configurable: false
      });
      obj.$$$PROXY$$$ = new Proxy(obj, {
        defineProperty: function(target, property, descriptor): boolean {
          if (!disableProxies) {
            // Capture a stack trace.
            _addStackTrace(target.$$$STACKTRACES$$$, property);
          }
          return Reflect.defineProperty(target, property, descriptor);
        },
        set: function(target, property, value, receiver): boolean {
          if (!disableProxies) {
            // Capture a stack trace.
            _addStackTrace(target.$$$STACKTRACES$$$, property);
          }
          return Reflect.set(target, property, value, target);
        },
        get: function(target, property, receiver): any {
          return Reflect.get(target, property, target);
        },
        deleteProperty: function(target, property): boolean {
          if (!disableProxies) {
            // Remove stack traces that set this property.
            _removeStacks(target.$$$STACKTRACES$$$, property);
          }
          return Reflect.deleteProperty(target, property);
        }
      });
    }
    return obj.$$$PROXY$$$;
  }

  /**
   * Installs a proxy object at the given location, and a getter/setter on the parent location to
   * capture writes to the heap location.
   * @param accessStr
   * @param parentAccessStr
   * @param parent
   * @param obj
   * @param propName
   */
  function installProxy(accessStr: string, parentAccessStr: string, parent: any, obj: any, propName: string | number): void {
    let hiddenValue = getProxy(accessStr, obj, true);
    if ((typeof(parent) === "object" || typeof(parent) === "function") && parent !== null) {
      Object.defineProperty(parent, propName, {
        get: function() {
          return hiddenValue;
        },
        set: function(val) {
          hiddenValue = getProxy(accessStr, val);
          return true;
        }
      });
    } else {
      console.log(`[PARENT FAILURE]: Unable to install getter on parent at ${parentAccessStr}.`);
    }
  }

  function replaceObjectsWithProxies(roots: any[], propName: string | number, accessStr: string, parentAccessStr: string): void {
    try {
      const getObjFcn: (root: any) => [any, any] | null = <any> new Function("root", `try { return [${parentAccessStr}, ${accessStr}]; } catch (e) { return null; }`);
      roots.map(getObjFcn).filter((o) => o !== null).forEach((objs) => {
        installProxy(accessStr, parentAccessStr, objs[0], objs[1], propName);
      });
    } catch (e) {
      console.log(`[PROXY REPLACE ERROR] Failed to install proxy at ${accessStr}: ${e}`);
    }
  }

  // Disables proxy interception.
  let disableProxies = false;
  function instrumentLocation(loc: SerializeableGrowthObject): void {
    const paths = loc.paths;
    // Fetch the objects.
    for (const p of paths) {
      const accessString = getAccessString(p, false);
      const parentAccessString = getAccessString(p, true);
      const roots = getPossibleRoots(p);
      if (p.path.length > 0) {
        replaceObjectsWithProxies(roots, p.path[p.path.length - 1].indexOrName, accessString, parentAccessString);
      }
    }
  }

  let instrumentedLocations: SerializeableGrowthObject[] = [];
  function $$$INSTRUMENT_PATHS$$$(locs: SerializeableGrowthObject[]): void {
    for (const loc of locs) {
      instrumentLocation(loc);
    }
    instrumentedLocations = instrumentedLocations.concat(locs);
  }

  function $$$GET_STACK_TRACE$$$(): string {
    const allMaps = new Map<number, Set<string>>();
    instrumentedLocations.forEach((loc) => {
      const stacks = new Set<string>();
      allMaps.set(loc.id, stacks);
      loc.paths.forEach((p) => {
        const accessStr = getAccessString(p, false);
        const roots = getPossibleRoots(p);
        const getObjFcn = <any> new Function("root", `try { return ${accessStr}; } catch (e) { return null; }`);
        roots.map(getObjFcn).forEach((o) => {
          if (isProxyable(o)) {
            const map: Map<string | number | symbol, Set<string>> = (<any> o)['$$$STACKTRACES$$$'];
            if (map) {
              map.forEach((propStacks, key) => {
                propStacks.forEach((s) => {
                  stacks.add(s);
                })
              });
            }
          }
        });
      });
    });

    const rv: {[i: number]: string[]} = {};
    allMaps.forEach((stacks, key) => {
      const arr = new Array<string>(stacks.size);
      rv[key] = arr;
      let i = 0;
      stacks.forEach((v) => {
        arr[i++] = v;
      });
    });

    return JSON.stringify(rv);
  }

  // Global variables.
  const IS_WINDOW = typeof(window) !== "undefined";
  const IS_WORKER = typeof(importScripts) !== "undefined";

  const root = <Window> (IS_WINDOW ? window : IS_WORKER ? self : global);
  root.$$$INSTRUMENT_PATHS$$$ = $$$INSTRUMENT_PATHS$$$;
  root.$$$GET_STACK_TRACE$$$ = $$$GET_STACK_TRACE$$$;
  root.$$$CREATE_SCOPE_OBJECT$$$ = $$$CREATE_SCOPE_OBJECT$$$;
  root.$$$EQ$$$ = $$$EQ$$$;
  root.$$$SEQ$$$ = $$$SEQ$$$;
  root.$$$SHOULDFIX$$$ = $$$SHOULDFIX$$$;
  root.$$$GLOBAL$$$ = root;
  root.$$$REWRITE_EVAL$$$ = $$$REWRITE_EVAL$$$;
  root.$$$FUNCTION_EXPRESSION$$$ = $$$FUNCTION_EXPRESSION$$$;

  if (IS_WINDOW || IS_WORKER) {
    // Disable these in NodeJS.

    const addEventListener = EventTarget.prototype.addEventListener;
    const removeEventListener = EventTarget.prototype.removeEventListener;
    EventTarget.prototype.addEventListener = function(this: EventTarget, type: string, listener: EventListenerOrEventListenerObject, useCapture: boolean = false) {
      addEventListener.apply(unwrapIfProxy(this), arguments);
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
      removeEventListener.apply(unwrapIfProxy(this), arguments);
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
          if (getProxyStatus(this) === ProxyStatus.IS_PROXY) {
            const map: Map<string | number | symbol,  Set<string>> = (<any> this)["$$$STACKTRACES$$$"];
            const trace = _getStackTrace();
            for (let i = 0; i < items.length; i++) {
              _addStackTrace(map, `${this.length + i}`, trace);
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
          if (getProxyStatus(this) === ProxyStatus.IS_PROXY) {
            const map: Map<string | number | symbol,  Set<string>> = (<any> this)["$$$STACKTRACES$$$"];
            const newItemLen = items.length;
            const trace = _getStackTrace();
            for (let i = items.length - 1; i >= 0; i--) {
              _copyStacks(map, `${i}`, `${i + newItemLen}`);
            }
            for (let i = 0; i < items.length; i++) {
              _removeStacks(map, `${i}`);
              _addStackTrace(map, `${i}`, trace);
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
          if (getProxyStatus(this) === ProxyStatus.IS_PROXY) {
            const map: Map<string | number | symbol,  Set<string>> = (<any> this)["$$$STACKTRACES$$$"];
            _removeStacks(map, `${this.length - 1}`);
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
          if (getProxyStatus(this) === ProxyStatus.IS_PROXY) {
            const map: Map<string | number | symbol,  Set<string>> = (<any> this)["$$$STACKTRACES$$$"];
            _removeStacks(map, "0");
            for (let i = 1; i < this.length; i++) {
              _copyStacks(map, `${i}`, `${i - 1}`);
            }
            _removeStacks(map, `${this.length - 1}`);
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
          if (getProxyStatus(this) === ProxyStatus.IS_PROXY) {
            const map: Map<string | number | symbol,  Set<string>> = (<any> this)["$$$STACKTRACES$$$"];
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
              _removeStacks(map, `${index}`);
            }

            // Move existing traces into new locations.
            const newItemCount = items.length;
            if (newItemCount > actualDeleteCount) {
              // Shift *upward*
              const delta = newItemCount - actualDeleteCount;
              for (let i = this.length - 1; i >= actualStart + actualDeleteCount; i--) {
                _copyStacks(map, `${i}`, `${i + delta}`);
              }
            } else if (newItemCount < actualDeleteCount) {
              // Shift *downward*
              const delta = newItemCount - actualDeleteCount;
              for (let i = actualStart + actualDeleteCount; i < this.length; i++) {
                _copyStacks(map, `${i}`, `${i + delta}`);
              }
              // Delete extra traces for removed indexes.
              for (let i = this.length + delta; i < this.length; i++) {
                _removeStacks(map, `${i}`);
              }
            }

            const trace = _getStackTrace();
            // Add new traces for new items.
            for (let i = 0; i < newItemCount; i++) {
              _removeStacks(map, `${actualStart + i}`);
              _addStackTrace(map, `${actualStart + i}`, trace);
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

    // interface Count {get: number; set: number; invoked: number }

    /**
     * [DEBUG] Installs a counter on a particular object property.
     * @param obj
     * @param property
     * @param key
     * @param countMap
     */
    /*function countPropertyAccesses(obj: any, property: string, key: string, countMap: Map<string, Count>): void {
      let count: Count = { get: 0, set: 0, invoked: 0};
      const original = Object.getOwnPropertyDescriptor(obj, property);
      try {
        Object.defineProperty(obj, property, {
          get: function() {
            count.get++;
            const value = original.get ? original.get.apply(this) : original.value;
            if (typeof(value) === "function") {
              return function(this: any) {
                count.invoked++;
                return value.apply(this, arguments);
              };
            } else {
              return value;
            }
          },
          set: function(v) {
            count.set++;
            if (original.set) {
              return original.set.call(this, v);
            } else if (original.writable) {
              original.value = v;
            }
            // Otherwise: NOP.
          },
          configurable: true
        });
        countMap.set(key, count);
      } catch (e) {
        console.log(`Unable to instrument ${key}`);
      }
    }*/

    /**
     * Interposes on a particular API to return proxy objects for objects with proxies and unwrap arguments that are proxies.
     */
    function proxyInterposition(obj: any, property: string, key: string): void {
      const original = Object.getOwnPropertyDescriptor(obj, property);
      try {
        Object.defineProperty(obj, property, {
          get: function() {
            const value = original.get ? original.get.apply(unwrapIfProxy(this)) : original.value;
            if (typeof(value) === "function") {
              return function(this: any, ...args: any[]) {
                return wrapIfOriginal(unwrapIfProxy(value).apply(unwrapIfProxy(this), args.map(unwrapIfProxy)));
              };
            } else {
              return wrapIfOriginal(value);
            }
          },
          set: function(v) {
            const originalV = unwrapIfProxy(v);
            if (original.set) {
              original.set.call(unwrapIfProxy(this), originalV);
            } else if (original.writable) {
              original.value = originalV;
            }
            // Otherwise: NOP.
          },
          // Make interposition nestable
          configurable: true
        });
      } catch (e) {
        console.log(`Unable to instrument ${key}`);
      }
    }

    /**
     * Interposition "on[eventname]" properties and store value as an expando
     * property on DOM element so it shows up in the heap snapshot.
     * @param obj
     * @param propName
     */
    function interpositionEventListenerProperty(obj: object, propName: string): void {
      const desc = Object.getOwnPropertyDescriptor(obj, propName);
      if (desc) {
        delete desc['value'];
        delete desc['writable'];
        const set = desc.set;
        desc.set = function(this: any, val: any) {
          set.call(this, val);
          this[`$$${propName}`] = val;
        };
        Object.defineProperty(obj, propName, desc);
      }
    }

    if (IS_WINDOW) {
      [Document.prototype, Element.prototype, MediaQueryList.prototype, FileReader.prototype,
        HTMLBodyElement.prototype, HTMLElement.prototype, HTMLFrameSetElement.prototype,
        ApplicationCache.prototype, //EventSource.prototype, SVGAnimationElement.prototype,
        SVGElement.prototype, XMLHttpRequest.prototype, //XMLHttpRequestEventTarget.prototype,
        WebSocket.prototype, IDBDatabase.prototype, IDBOpenDBRequest.prototype,
        IDBRequest.prototype, IDBTransaction.prototype, window].forEach((obj) => {
          Object.keys(obj).filter((p) => p.startsWith("on")).forEach((p) => {
            interpositionEventListenerProperty(obj, p);
          });
        });

      //const countMap = new Map<string, Count>();
      [[Node.prototype, "Node"], [Element.prototype, "Element"], [HTMLElement.prototype, "HTMLElement"],
      [Document.prototype, "Document"], [HTMLCanvasElement.prototype, "HTMLCanvasElement"]]
        .forEach((v) => Object.keys(v[0]).forEach((k) => proxyInterposition(v[0], k, `${v[1]}.${k}`)));
    }



    /*(<any> root)['$$PRINTCOUNTS$$'] = function(): void {
      console.log(`API,GetCount,InvokedCount,SetCount`);
      countMap.forEach((v, k) => {
        if (v.get + v.set + v.invoked > 0) {
          console.log(`${k},${v.get},${v.invoked},${v.set}`);
        }
      });
    };*/

    // Goal:
    // - Attach unique IDs to all HTML tags in the DOM corresponding to their location post-body-load.
    // - On update: Update IDs.
    // - Insertion to scope modifies all IDs in scope.

    // Possibilities:
    // - Node is only in DOM.
    //   - Instrument DOM location.
    // - Node is only in heap.
    //   - Instrument node object.
    // - Node is in both.
    //   - Instrument both.

    // Regardless:
    // - Need to *unwrap* arguments
    // - Need to *wrap* return values

    // Node:
    // nodeValue: Not important?
    // textContent: Pass it a string. Replaces content.
    // appendChild: Passed a Node. Modifies DOM.
    // insertBefore: Takes Nodes. Modifies DOM.
    // isEqualNode: Takes a Node.
    // isSameNode: Takes a Node.
    // normalize: Removes things from DOM.
    // removeChild: Removes a child.
    // replaceChild: Replaces a child.

    // Element:
    // innerHTML
    // outerHTML
    // insertAdjacentElement
    // insertAdjacentHTML
    // insertAdjacentText
    // remove
    // **SPECIAL**: dataset - modifies properties on DOM object through object!!!!
    // -> throw exception if used.

    // SVGElement:
    // dataset: Throw exception if used

    // On properties:
    // - Document.prototype
    // - Element.prototype
    // - MediaQueryList.prototype
    // - FileReader.prototype
    // - HTMLBodyElement
    // - HTMLElement
    // - HTMLFrameSetElement
    // - AudioTrackList? TextTrack? TextTrackCue? TextTrackList? VideoTrackList?
    // - ApplicationCache
    // - EventSource
    // - SVGAnimationElement
    // - SVGElement
    // - Performance?
    // - Worker?
    // - XMLHttpRequest
    // - XMLHttpRequestEventTarget
    // - WebSocket
    // - IDBDatabase
    // - IDBOpenDBRequest
    // - IDBRequest
    // - IDBTransaction
    // - window.[property] (Special)


  }
})();