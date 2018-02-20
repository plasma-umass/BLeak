"no transform";

interface Object {
  $$$PROXY$$$?: any;
}

interface Scope {
  [ident: string]: any;
}

interface Function {
  __scope__: Scope;
}

interface MirrorNode {
  root: Node;
  childNodes: ChildNodes;
}

interface ChildNodes {
  [p: string]: MirrorNode | number;
  length: number;
}

interface Window {
  $$$INSTRUMENT_PATHS$$$(p: IPathTrees): void;
  $$$GET_STACK_TRACES$$$(): GrowingStackTraces;
  $$$CREATE_SCOPE_OBJECT$$$(parentScopeObject: Scope, movedVariables: string[], unmovedVariables: PropertyDescriptorMap, args: string[], argValues: any[]): Scope;
  $$$SEQ$$$(a: any, b: any): boolean;
  $$$EQ$$$(a: any, b: any): boolean;
  $$$SHOULDFIX$$$(n: number): boolean;
  $$$GLOBAL$$$: Window;
  $$$REWRITE_EVAL$$$(scope: any, source: string): any;
  $$$FUNCTION_EXPRESSION$$$(fcn: Function, scope: Scope): Function;
  $$$OBJECT_EXPRESSION$$$(obj: object, scope: Scope): object;
  $$$CREATE_WITH_SCOPE$$$(withObj: Object, scope: Scope): Scope;
  $$$SERIALIZE_DOM$$$(): void;
  $$$DOM$$$: MirrorNode;
}

interface ListenerInfo {
  useCapture: boolean | object;
  listener: EventListenerOrEventListenerObject;
}

interface EventTarget {
  $$listeners?: {[type: string]: ListenerInfo[]};
  // Note: Needs to be a string so it shows up in the snapshot.
  $$id?: string;
}

interface NodeList {
  $$$TREE$$$: IPathTree;
  $$$ACCESS_STRING$$$: string;
  $$$STACKTRACES$$$: GrowthObjectStackTraces;
  $$$REINSTRUMENT$$$(): void;
}

interface Node {
  $$$TREE$$$: IPathTree;
  $$$ACCESS_STRING$$$: string;
  $$$STACKTRACES$$$: GrowthObjectStackTraces;
  $$$REINSTRUMENT$$$(): void;
}

type GrowthObjectStackTraces = Map<string | number | symbol, Set<string>>;

declare function importScripts(s: string): void;

/**
 * Agent injected into the webpage to surface browser-hidden leaks at the JS level.
 */
(function() {
  // Global variables.
  const IS_WINDOW = typeof(window) !== "undefined";
  const IS_WORKER = typeof(importScripts) !== "undefined";
  const ROOT = <Window> (IS_WINDOW ? window : IS_WORKER ? self : global);
  // Avoid installing self twice.
  if (ROOT.$$$INSTRUMENT_PATHS$$$) {
    return;
  }
  ROOT.$$$INSTRUMENT_PATHS$$$ = $$$INSTRUMENT_PATHS$$$;
  ROOT.$$$GET_STACK_TRACES$$$ = $$$GET_STACK_TRACES$$$;
  ROOT.$$$CREATE_SCOPE_OBJECT$$$ = $$$CREATE_SCOPE_OBJECT$$$;
  ROOT.$$$EQ$$$ = $$$EQ$$$;
  ROOT.$$$SEQ$$$ = $$$SEQ$$$;
  ROOT.$$$SHOULDFIX$$$ = $$$SHOULDFIX$$$;
  ROOT.$$$GLOBAL$$$ = ROOT;
  ROOT.$$$REWRITE_EVAL$$$ = $$$REWRITE_EVAL$$$;
  ROOT.$$$FUNCTION_EXPRESSION$$$ = $$$FUNCTION_EXPRESSION$$$;
  ROOT.$$$OBJECT_EXPRESSION$$$ = $$$OBJECT_EXPRESSION$$$;
  ROOT.$$$CREATE_WITH_SCOPE$$$ = $$$CREATE_WITH_SCOPE$$$;
  ROOT.$$$SERIALIZE_DOM$$$ = $$$SERIALIZE_DOM$$$;

  const r = /'/g;
  // Some websites overwrite logToConsole.
  const console = ROOT.console ? ROOT.console : { log: (str: string) => {} };
  const consoleLog = console.log;
  function logToConsole(s: string) {
    consoleLog.call(console, s);
  }

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
   * Applies a write to the given scope. Used in `eval()` to avoid storing/transmitting
   * metadata for particular scope objects.
   *
   * Searches the scope chain for the given `key`. If found, it overwrites the value on
   * the relevant scope in the scope chain.
   * @param target
   * @param key
   * @param value
   */
  function applyWrite(target: Scope, key: string, value: any): boolean {
    if (target === null) {
      return false;
    } else if (target.hasOwnProperty(key)) {
      target[key] = value;
      return true;
    } else {
      return applyWrite(Object.getPrototypeOf(target), key, value);
    }
  }

  // Sentinel
  const PROP_NOT_FOUND = {};

  /**
   * Goes up the scope chain of the object (which may be a scope or the target
   * of a `with()` statement) to determine if a given key is defined in the object.
   * @param target The scope object or with target.
   * @param key The key we are looking for.
   */
  function withGet(target: any, key: string): any {
    if (key in target) {
      return target[key];
    } else {
      return PROP_NOT_FOUND;
    }
  }

  // Reuseable eval() function. Does not have a polluted scope.
  const EVAL_FCN = new Function('scope', '$$$SRC$$$', 'return eval($$$SRC$$$);');
  // Caches compiled eval statements from server to reduce synchronous XHRs.
  const EVAL_CACHE = new Map<string, { e: string, ts: number }>();
  const EVAL_CACHE_LIMIT = 100;

  /**
   * Removes the 10 items from EVAL_CACHE that were least recently used.
   */
  function trimEvalCache() {
    const items: {e: string, ts: number}[] = [];
    EVAL_CACHE.forEach((i) => items.push(i));
    items.sort((a, b) => a.ts - b.ts);
    items.slice(0, 10).forEach((i) => {
      EVAL_CACHE.delete(i.e);
    });
  }

  /**
   * Sends text passed to `eval` to the server for rewriting,
   * and then evaluates the new string.
   * @param scope The context in which eval was called.
   * @param text The JavaScript code to eval.
   */
  function $$$REWRITE_EVAL$$$(scope: any, source: string): any {
    let cache = EVAL_CACHE.get(source);
    if (!cache) {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/eval', false);
      xhr.setRequestHeader("Content-type", "application/json");
      xhr.send(JSON.stringify({ scope: "scope", source }));
      cache = { e: xhr.responseText, ts: 0 };
      EVAL_CACHE.set(source, cache);
      if (EVAL_CACHE.size > EVAL_CACHE_LIMIT) {
        trimEvalCache();
      }
    }
    // Update timestamp
    cache.ts = Date.now();
    return EVAL_FCN(new Proxy(scope, {
      // Appropriately relay writes to first scope with the given variable name.
      // Otherwise, it'll overwrite the property on the outermost scope!
      set: applyWrite
    }), cache.e);
  }

  /**
   * Creates a Scope object for use in a `with()` statement.
   * @param withObj The target of the `with` statement.
   * @param scope The scope of the `with()` statement.
   */
  function $$$CREATE_WITH_SCOPE$$$(withObj: Object, scope: Scope): Scope {
    // Add 'withObj' to the scope chain.
    return new Proxy(withObj, {
      get: function(target, key: string) {
        const v = withGet(target, key);
        if (v === PROP_NOT_FOUND) {
          const v = withGet(scope, key);
          if (v === PROP_NOT_FOUND) {
            throw new ReferenceError(`${key} is not defined`);
          }
          return v;
        } else {
          return v;
        }
      },
      set: function(target, key: string, value) {
        return applyWrite(target, key, value) || applyWrite(scope, key, value);
      }
    });
  }

  /**
   * Assigns the given scope to the given function object.
   */
  function $$$FUNCTION_EXPRESSION$$$(fcn: Function, scope: Scope): Function {
    Object.defineProperty(fcn, '__scope__', {
      get: function() {
        return scope;
      },
      configurable: true
    });
    return fcn;
  }

  /**
   * Assigns the given scope to getter/setter properties.
   * @param obj
   * @param scope
   */
  function $$$OBJECT_EXPRESSION$$$(obj: object, scope: Scope): object {
    const props = Object.getOwnPropertyDescriptors(obj);
    for (const prop of props) {
      if (prop.get) {
        $$$FUNCTION_EXPRESSION$$$(prop.get, scope);
      }
      if (prop.set) {
        $$$FUNCTION_EXPRESSION$$$(prop.set, scope);
      }
    }
    return obj;
  }



  // Used to store child nodes as properties on an object rather than in an array to facilitate
  // leak detection.
  const NODE_PROP_PREFIX = "$$$CHILD$$$";
  /**
   * Converts the node's tree structure into a JavaScript-visible tree structure.
   * TODO: Mutate to include any other Node properties that could be the source of leaks!
   * @param n
   */
  function makeMirrorNode(n: Node): MirrorNode {
    const childNodes = n.childNodes;
    const m: MirrorNode = { root: n, childNodes: makeChildNode(childNodes) };
    return m;
  }

  /**
   * Converts the childNodes nodelist into a JS-level object.
   * @param cn
   */
  function makeChildNode(cn: NodeList): ChildNodes {
    const numChildren = cn.length;
    let rv: ChildNodes = { length: numChildren };
    for (let i = 0; i < numChildren; i++) {
      rv[`${NODE_PROP_PREFIX}${i}`] = makeMirrorNode(cn[i]);
    }
    return rv;
  }

  /**
   * Serializes the DOM into a JavaScript-visible tree structure.
   */
  function $$$SERIALIZE_DOM$$$(n: Node = document): void {
    ROOT.$$$DOM$$$ = makeMirrorNode(document);
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

  function getProxyStackTraces(a: any): GrowthObjectStackTraces {
    return a.$$$STACKTRACES$$$;
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
   * Adds a stack trace to the given map for the given property.
   * @param map
   * @param property
   */
  function _addStackTrace(map: GrowthObjectStackTraces, property: string | number | symbol, stack = _getStackTrace()): void {
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
  function _removeStacks(map: GrowthObjectStackTraces, property: string | number | symbol): void {
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
  function _copyStacks(map: GrowthObjectStackTraces, from: string | number | symbol, to: string | number | symbol): void {
    if (map.has(from)) {
      map.set(to, map.get(from));
    }
  }

  /**
   * Combine the stacks for 'from' with 'to' in 'to'.
   * @param map
   * @param from
   * @param to
   */
  function _combineStacks(map: GrowthObjectStackTraces, from: string | number | symbol, to: symbol | number | string): void {
    if (map.has(from) && map.has(to)) {
      const fromStacks = map.get(from);
      const toStacks = map.get(to);
      fromStacks.forEach((s) => {
        toStacks.add(s);
      });
    }
  }

  /**
   * Initialize a map to contain stack traces for all of the properties of the given object.
   */
  function _initializeMap(obj: any, map: GrowthObjectStackTraces, trace: string): GrowthObjectStackTraces {
    Object.keys(obj).forEach((k) => {
      _addStackTrace(map, k, trace);
    });
    return map;
  }

  /**
   * Returns a proxy object for the given object, if applicable. Creates a new object if the object
   * is not already proxied.
   */
  function getProxy(accessStr: string, obj: any, stackTrace: string = null): any {
    if (!isProxyable(obj)) {
      // logToConsole(`[PROXY ERROR]: Cannot create proxy for ${obj} at ${accessStr}.`);
      return obj;
    } else if (!obj.hasOwnProperty('$$$PROXY$$$')) {
      const map = new Map<string | number | symbol, Set<string>>();
      if (stackTrace !== null) {
        _initializeMap(obj, map, stackTrace);
      }
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
      //function LOG(s: string) {
        // logToConsole(`${accessStr}: ${s}`);
      //}
      Object.defineProperty(obj, '$$$PROXY$$$', { value: new Proxy(obj, {
        defineProperty: function(target, property, descriptor): boolean {
          if (!disableProxies) {
            // Capture a stack trace.
            _addStackTrace(getProxyStackTraces(target), property);
          }
          // LOG(`defineProperty`);
          return Reflect.defineProperty(target, property, descriptor);
        },
        set: function(target, property, value, receiver): boolean {
          if (!disableProxies) {
            // Capture a stack trace.
            _addStackTrace(getProxyStackTraces(target), property);
          }
          // LOG(`set`);
          return Reflect.set(target, property, value, target);
        },
        deleteProperty: function(target, property): boolean {
          if (!disableProxies) {
            // Remove stack traces that set this property.
            _removeStacks(getProxyStackTraces(target), property);
          }
          // LOG(`deleteProperty`);
          return Reflect.deleteProperty(target, property);
        }
      }), enumerable: false, configurable: true, writable: true });
    }
    return obj.$$$PROXY$$$;
  }

  interface AssignmentProxy {
    (v: any): boolean;
    $$trees: IPathTree[];
    $$rootAccessString: string;
    $$update: (stackTrace: string) => void;
    $$root: any;
  }

  function updateAssignmentProxy(this: AssignmentProxy, stackTrace: string): void {
    const root = this.$$root;
    const trees = this.$$trees;
    const rootAccessString = this.$$rootAccessString;
    for (const tree of trees) {
      instrumentTree(rootAccessString, root, tree, stackTrace);
    }
  }

  function hiddenPropertyName(n: string | number): string {
    return `_____$${n}`;
  }

  function setHiddenValue(thisObj: any, n: string | number, value: any): void {
    const propName = hiddenPropertyName(n);
    if (!thisObj.hasOwnProperty(propName)) {
      Object.defineProperty(thisObj, propName, {
        value: null,
        writable: true
      });
    }
    thisObj[propName] = value;
  }

  function getHiddenValue(thisObj: any, n: string | number): any {
    return thisObj[hiddenPropertyName(n)];
  }

  function instrumentPath(rootAccessString: string, accessString: string, root: any, tree: IPathTree, stackTrace: string = null): void {
    let setProxy: AssignmentProxy;
    //logToConsole(`Instrumenting ${accessString} at ${rootAccessString}`);
    const prop = Object.getOwnPropertyDescriptor(root, tree.indexOrName);
    if (prop && prop.set && Array.isArray((<any> prop.set)['$$trees'])) {
      //logToConsole(`It's already instrumented!`);
      setProxy = <any> prop.set;
    } else {
      //logToConsole(`New instrumentation.`);
      // let hiddenValue = root[tree.indexOrName];
      const isGrowing = tree.isGrowing;
      const indexOrName = tree.indexOrName;
      setHiddenValue(root, indexOrName, root[indexOrName]);
      if (isGrowing) {
        //logToConsole(`Converting the hidden value into a proxy.`)
        const proxy = getProxy(accessString, getHiddenValue(root, indexOrName));
        setHiddenValue(root, indexOrName, proxy);
        if (stackTrace !== null && getProxyStatus(proxy) === ProxyStatus.IS_PROXY) {
          const map: GrowthObjectStackTraces = getProxyStackTraces(proxy);
          _initializeMap(proxy, map, stackTrace);
        }
      }
      setProxy = <any> function(this: any, v: any): boolean {
        const trace = _getStackTrace();
        setHiddenValue(this, indexOrName, isGrowing ? getProxy(accessString, v, trace) : v);
        setProxy.$$update(trace);
        // logToConsole(`${rootAccessString}: Assignment`);
        return true;
      };
      setProxy.$$rootAccessString = rootAccessString;
      setProxy.$$trees = [];
      setProxy.$$update = updateAssignmentProxy;
      setProxy.$$root = root;

      try {
        Object.defineProperty(root, indexOrName, {
          get: function(this: any) {
            return getHiddenValue(this, indexOrName);
          },
          set: setProxy,
          configurable: true
        });
      } catch (e) {
        logToConsole(`Unable to instrument ${rootAccessString}: ${e}`);
      }
    }

    if (setProxy.$$trees.indexOf(tree) === -1) {
      setProxy.$$trees.push(tree);
      // Only update inner proxies if:
      // - the tree is new (tree already exists === this path is already updated)
      //   - Prevents infinite loops due to cycles!
      // - there is a stack trace (no stack trace === initial installation)
      //   - Otherwise we are already updating this proxy!
      if (stackTrace) {
        setProxy.$$update(stackTrace);
      }
    }
  }

  // Need:
  // - DOM set proxies
  //   -> Invalidate / refresh when changed
  // - Fast checker of node.

  // Operations can impact:
  // - Current node
  // - Parent node
  // - Child nodes
  // Update target node & all children.
  //

  function instrumentDOMTree(rootAccessString: string, root: any, tree: IPathTree, stackTrace: string = null): void {
    // For now: Simply crawl to the node(s) and instrument regularly from there. Don't try to plant getters/setters.
    // $$DOM - - - - - -> root [regular subtree]
    let obj: any;
    let accessString = rootAccessString;
    let switchToRegularTree = false;
    switch (tree.indexOrName) {
      case "$$$DOM$$$":
        obj = document;
        accessString = "document";
        break;
      case 'root':
        switchToRegularTree = true;
        obj = root;
        break;
      case 'childNodes':
        obj = root['childNodes'];
        accessString += `['childNodes']`;
        break;
      default:
        const modIndex = (<string> tree.indexOrName).slice(NODE_PROP_PREFIX.length);
        obj = root[modIndex];
        accessString += `[${modIndex}]`;
        break;
    }

    if (!obj) {
      return;
    }

    if (obj && !obj.$$$TREE$$$) {
      Object.defineProperties(obj, {
        $$$TREE$$$: {
          value: null,
          writable: true,
          configurable: true
        },
        $$$ACCESS_STRING$$$: {
          value: null,
          writable: true,
          configurable: true
        }
      });
    }
    obj.$$$TREE$$$ = tree;
    obj.$$$ACCESS_STRING$$$ = accessString;
    if (tree.isGrowing) {
      getProxy(accessString, obj, stackTrace);
    }

    // Capture writes of children.
    const children = tree.children;
    if (children) {
      const instrumentFunction = switchToRegularTree ? instrumentTree : instrumentDOMTree;
      const len = children.length;
      for (let i = 0; i < len; i++) {
        const child = children[i];
        instrumentFunction(accessString, obj, child, stackTrace);
      }
    }
  }

  function instrumentTree(rootAccessString: string, root: any, tree: IPathTree, stackTrace: string = null): void {
    const accessString = rootAccessString + `[${safeString(`${tree.indexOrName}`)}]`;
    //logToConsole(`access string: ${accessString}`);
    // Ignore roots that are not proxyable.
    if (!isProxyable(root)) {
      //logToConsole(`Not a proxyable root.`);
      return;
    }
    const obj = root[tree.indexOrName];
    instrumentPath(rootAccessString, accessString, root, tree, stackTrace);

    // Capture writes of children.
    const children = tree.children;
    if (children) {
      const len = children.length;
      for (let i = 0; i < len; i++) {
        const child = children[i];
        instrumentTree(accessString, obj, child, stackTrace);
      }
    }
  }

  // Disables proxy interception.
  let disableProxies = false;

  function isDOMRoot(tree: IPathTree): boolean {
    return tree.indexOrName === "$$$DOM$$$";
  }

  let instrumentedTrees: IPathTrees = [];
  function $$$INSTRUMENT_PATHS$$$(trees: IPathTrees): void {
    for (const tree of trees) {
      if (isDOMRoot(tree)) {
        instrumentDOMTree("$$$GLOBAL$$$", ROOT.$$$GLOBAL$$$, tree);
      } else {
        instrumentTree("$$$GLOBAL$$$", ROOT.$$$GLOBAL$$$, tree);
      }
    }
    instrumentedTrees = instrumentedTrees.concat(trees);
  }

  function getStackTraces(root: any, path: IPathTree, stacksMap: {[id: number]: Set<string>}): void {
    const obj = root[path.indexOrName];
    if (isProxyable(obj)) {
      if (path.isGrowing && getProxyStatus(obj) === ProxyStatus.IS_PROXY) {
        const map = getProxyStackTraces(obj);
        const stackTraces = stacksMap[path.id] ? stacksMap[path.id] : new Set<string>();
        map.forEach((v, k) => {
          v.forEach((s) => stackTraces.add(s));
        });
        stacksMap[path.id] = stackTraces;
      }

      const children = path.children;
      if (children) {
        for (const child of children) {
          getStackTraces(obj, child, stacksMap);
        }
      }
    }
  }

  function getDOMStackTraces(root: any, path: IPathTree, stacksMap: {[id: number]: Set<string>}): void {
    let obj: any;
    let switchToRegularTree = false;
    switch (path.indexOrName) {
      case "$$$DOM$$$":
        obj = document;
        break;
      case 'root':
        switchToRegularTree = true;
        obj = root;
        break;
      case 'childNodes':
        obj = root[path.indexOrName];
        break;
      default:
        obj = root[(<string> path.indexOrName).slice(NODE_PROP_PREFIX.length)];
        break;
    }

    if (isProxyable(obj) && path.isGrowing) {
      const wrappedObj = wrapIfOriginal(obj);
      if (getProxyStatus(wrappedObj) === ProxyStatus.IS_PROXY) {
        const map = getProxyStackTraces(wrappedObj);
        const stackTraces = stacksMap[path.id] ? stacksMap[path.id] : new Set<string>();
        map.forEach((v, k) => {
          v.forEach((s) => stackTraces.add(s));
        });
        stacksMap[path.id] = stackTraces;
      }
    }

    // Capture writes of children.
    const children = path.children;
    const getStackTracesFunction = switchToRegularTree ? getStackTraces : getDOMStackTraces;
    if (children) {
      const len = children.length;
      for (let i = 0; i < len; i++) {
        const child = children[i];
        getStackTracesFunction(obj, child, stacksMap);
      }
    }
  }

  function $$$GET_STACK_TRACES$$$(): GrowingStackTraces {
    const stacksMap: {[id: number]: Set<string>} = {};
    for (const tree of instrumentedTrees) {
      if (isDOMRoot(tree)) {
        getDOMStackTraces(ROOT.$$$GLOBAL$$$, tree, stacksMap);
      } else {
        getStackTraces(ROOT.$$$GLOBAL$$$, tree, stacksMap);
      }
    }
    const jsonableStacksMap: GrowingStackTraces = {};
    for (const stringId in stacksMap) {
      if (stacksMap.hasOwnProperty(stringId)) {
        const id = parseInt(stringId, 10);
        const stacks = stacksMap[id];
        let i = 0;
        const stackArray = new Array<string>(stacks.size);
        stacks.forEach((s) => {
          stackArray[i++] = s;
        })
        jsonableStacksMap[id] = stackArray;
      }
    }
    return jsonableStacksMap;
  }

  if (IS_WINDOW || IS_WORKER) {
    // Disable these in NodeJS.

    /*const documentWrite = Document.prototype.write;
    Document.prototype.write = function(this: Document, str: string): void {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/evalHtml', false);
      xhr.send(str);
      return documentWrite.call(this, xhr.responseText);
    };
    Document.prototype.writeln = function(this: Document, str: string): void {
      return this.write(str);
    };*/

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
        if (listenerInfo.listener === listener && (typeof(listenerInfo.useCapture) === 'boolean' ? listenerInfo.useCapture === useCapture : true)) {
          return;
        }
      }
      listeners.push({
        listener: listener,
        useCapture: useCapture
      });
    };

    EventTarget.prototype.removeEventListener = function(this: EventTarget, type: string, listener: EventListenerOrEventListenerObject, useCapture: boolean | object = false) {
      removeEventListener.apply(unwrapIfProxy(this), arguments);
      if (this.$$listeners) {
        const listeners = this.$$listeners[type];
        if (listeners) {
          for (let i = 0; i < listeners.length; i++) {
            const lInfo = listeners[i];
            if (lInfo.listener === listener && (typeof(lInfo.useCapture) === 'boolean' ? lInfo.useCapture === useCapture : true)) {
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
            const map: GrowthObjectStackTraces = getProxyStackTraces(this);
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
            const map: GrowthObjectStackTraces = getProxyStackTraces(this);
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
            const map: GrowthObjectStackTraces = getProxyStackTraces(this);
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
            const map: GrowthObjectStackTraces = getProxyStackTraces(this);
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
            const map: GrowthObjectStackTraces = getProxyStackTraces(this);
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

    // Make indexOf use $$$SEQ$$$
    Array.prototype.indexOf = function(this: Array<any>, searchElement, fromIndexArg?: number): any {
      let fromIndex = fromIndexArg || 0;
      // If the provided index value is a negative number, it is taken as the offset from the end of the array.
      // The array is still searched from front to back.
      if (fromIndex < 0) {
        fromIndex = this.length + fromIndex;
      }
      // If the calculated index is less than 0, then the whole array will be searched.
      if (fromIndex < 0) {
        fromIndex = 0;
      }
      // If the index is greater than or equal to the array's length, -1 is returned, which means the array will not be searched.
      if (fromIndex >= this.length) {
        return -1;
      }

      for (; fromIndex < this.length; fromIndex++) {
        if ($$$SEQ$$$(this[fromIndex], searchElement)) {
          return fromIndex;
        }
      }
      return -1;
    };

    Array.prototype.lastIndexOf = function(this: any[], searchElement: any, fromIndex = 0): number {
      if (this === void 0 || this === null) {
        throw new TypeError();
      }

      let t = Object(this),
        len = t.length >>> 0;
      if (len === 0) {
        return -1;
      }

      let n = len - 1;
      if (arguments.length > 1) {
        n = Number(arguments[1]);
        if (n != n) {
          n = 0;
        } else if (n != 0 && n != (1 / 0) && n != -(1 / 0)) {
          n = (n > 0 ? 1 : -1) * Math.floor(Math.abs(n));
        }
      }

      for (let k = n >= 0 ? Math.min(n, len - 1) : len - Math.abs(n); k >= 0; k--) {
        if (k in t && $$$SEQ$$$(t[k], searchElement)) {
          return k;
        }
      }
      return -1;
    };

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

    // Deterministic Date.now(), so YUI variable is deterministic.
    let dateNowCount = 0;
    Date.now = Date.prototype.getTime = function() {
      return 1516992512425 + (dateNowCount++);
    };

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
        logToConsole(`Unable to instrument ${key}`);
      }
    }*/

    /**
     * Interposes on a particular API to return proxy objects for objects with proxies and unwrap arguments that are proxies.
     */
    function proxyInterposition(obj: any, property: string, key: string): void {
      const original = Object.getOwnPropertyDescriptor(obj, property);
      if (!original.configurable) {
        return;
      }
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
        logToConsole(`Unable to instrument ${key}`);
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
      [Document.prototype, "Document"], [HTMLCanvasElement.prototype, "HTMLCanvasElement"],
      [NodeList.prototype, "NodeList"]]
        .forEach((v) => Object.keys(v[0]).forEach((k) => proxyInterposition(v[0], k, `${v[1]}.${k}`)));

      // TODO: Remove instrumentation when element moved?

      const $$$REINSTRUMENT$$$ = function(this: Node | NodeList): void {
        if (this.$$$TREE$$$) {
          instrumentDOMTree(this.$$$ACCESS_STRING$$$, this, this.$$$TREE$$$, _getStackTrace());
        }
      };
      Object.defineProperty(Node.prototype, '$$$REINSTRUMENT$$$', {
        value: $$$REINSTRUMENT$$$,
        configurable: true
      });
      Object.defineProperty(NodeList.prototype, '$$$REINSTRUMENT$$$', {
        value: $$$REINSTRUMENT$$$,
        configurable: true
      });

      const textContent = Object.getOwnPropertyDescriptor(Node.prototype, 'textContent');
      // textContent: Pass in a string. Replaces all children w/ a single text node.
      Object.defineProperty(Node.prototype, 'textContent', {
        get: textContent.get,
        set: function(this: Node, v: any) {
          const rv = textContent.set.call(this, v);
          const cn = this.childNodes;
          if (getProxyStatus(cn) === ProxyStatus.IS_PROXY) {
            const traces = getProxyStackTraces(cn);
            traces.clear();
            _initializeMap(cn, traces, _getStackTrace());
          }
          this.childNodes.$$$REINSTRUMENT$$$();
          return rv;
        },
        enumerable: true,
        configurable: true
      });

      const appendChild = Node.prototype.appendChild;
      Node.prototype.appendChild = function<T extends Node>(this: Node, newChild: T): T {
        /**
         * The Node.appendChild() method adds a node to the end of the list of children of a specified parent node.
         * If the given child is a reference to an existing node in the document,
         * appendChild() moves it from its current position to the new position.
         */
        if (newChild.parentNode !== null) {
          newChild.parentNode.removeChild(newChild);
        }

        const cn = this.childNodes;
        if (getProxyStatus(cn) === ProxyStatus.IS_PROXY) {
          const traces = getProxyStackTraces(cn);
          _addStackTrace(traces, `${cn.length}`);
        }

        const rv = appendChild.call(this, newChild);
        cn.$$$REINSTRUMENT$$$();
        return rv;
      };

      const insertBefore = Node.prototype.insertBefore;
      // insertBefore: Takes Nodes. Modifies DOM.
      Node.prototype.insertBefore = function<T extends Node>(newChild: T, refChild: Node): T {
        /**
         * The Node.insertBefore() method inserts the specified node before the reference
         * node as a child of the current node.
         *
         * If referenceNode is null, the newNode is inserted at the end of the list of child nodes.
         *
         * Note that referenceNode is not an optional parameter -- you must explicitly pass a Node
         * or null. Failing to provide it or passing invalid values may behave differently in
         * different browser versions.
         */
        const cn = this.childNodes;
        if (getProxyStatus(cn) === ProxyStatus.IS_PROXY) {
          if (refChild === null) {
            // Avoid tracking stack traces for special case.
            return this.appendChild(newChild);
          } else {
            const stacks = getProxyStackTraces(cn);
            const len = cn.length;
            let position = -1;
            for (let i = 0; i < len; i++) {
              if ($$$SEQ$$$(cn[i], refChild)) {
                position = i;
                break;
              }
            }
            if (position === -1) {
              logToConsole(`insertBefore called with invalid node!`);
            } else {
              for (let i = len - 1; i >= position; i--) {
                _copyStacks(stacks, `${i}`, `${i + 1}`);
              }
              _removeStacks(stacks, `${position}`);
              _addStackTrace(stacks, `${position}`);
            }
          }
        }
        const rv = insertBefore.call(this, newChild, refChild);
        cn.$$$REINSTRUMENT$$$();
        return rv;
      };

      const normalize = Node.prototype.normalize;
      function normalizeInternal(n: Node): void {
        const children = n.childNodes;
        const len = children.length;
        const stacks = getProxyStackTraces(n.childNodes);
        let prevTextNode: Node = null;
        let prevTextNodeI: number = -1;
        let toRemove: number[] = [];
        for (let i = 0; i < len; i++) {
          const child = children[i];
          if (child.nodeType === Node.TEXT_NODE) {
            if (child.textContent === "") {
              // Remove empty text nodes.
              toRemove.push(i);
            } else if (prevTextNode) {
              // Merge adjacent text nodes.
              prevTextNode.textContent += child.textContent;
              if (stacks) {
                _combineStacks(stacks, `${prevTextNodeI}`, `${i}`);
              }
              toRemove.push(i);
            } else {
              prevTextNode = child;
              prevTextNodeI = i;
            }
          } else {
            prevTextNode = null;
            prevTextNodeI = -1;
          }
        }
        const removeLen = toRemove.length;
        for (let i = removeLen - 1; i >= 0; i--) {
          n.removeChild(children[toRemove[i]]);
        }
        const len2 = children.length;
        for (let i = 0; i < len2; i++) {
          normalizeInternal(children[i]);
        }
      }
      Node.prototype.normalize = function(this: Node): void {
        /**
         * The Node.normalize() method puts the specified node and all of its sub-tree into a
         * "normalized" form. In a normalized sub-tree, no text nodes in the sub-tree are empty
         * and there are no adjacent text nodes.
         */
        if (this.$$$TREE$$$) {
          normalizeInternal(this);
          this.$$$REINSTRUMENT$$$();
        } else {
          return normalize.call(this);
        }
      };

      const removeChild = Node.prototype.removeChild;
      Node.prototype.removeChild = function<T extends Node>(this: Node, child: T): T {
        const cn = this.childNodes;
        if (getProxyStatus(cn) === ProxyStatus.IS_PROXY) {
          const stacks = getProxyStackTraces(cn);
          const children = this.childNodes;
          const len = children.length;
          let i = 0;
          for (; i < len; i++) {
            if ($$$SEQ$$$(children[i], child)) {
              break;
            }
          }
          if (i === len) {
            logToConsole(`Invalid call to removeChild.`)
          } else {
            for (let j = i + 1; j < len; j++) {
              _copyStacks(stacks, `${j}`, `${j - 1}`);
            }
            _removeStacks(stacks, `${len - 1}`);
          }
        }
        const rv = removeChild.call(this, child);
        cn.$$$REINSTRUMENT$$$();
        return rv;
      }

      // replaceChild: Replaces a child.
      const replaceChild = Node.prototype.replaceChild;
      Node.prototype.replaceChild = function<T extends Node>(this: Node, newChild: Node, oldChild: T): T {
        const cn = this.childNodes;
        if (getProxyStatus(cn) === ProxyStatus.IS_PROXY) {
          const stacks = getProxyStackTraces(cn);
          let i = 0;
          const len = cn.length;
          for (; i < len; i++) {
            if ($$$SEQ$$$(cn[i], oldChild)) {
              break;
            }
          }
          if (i === len) {
            logToConsole(`replaceChild called with invalid child`);
          } else {
            _addStackTrace(stacks, `${i}`);
          }
        }
        const rv = replaceChild.call(this, newChild, oldChild);
        cn.$$$REINSTRUMENT$$$();
        return rv;
      }

      const innerHTML = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');
      Object.defineProperty(Element.prototype, 'innerHTML', {
        get: innerHTML.get,
        set: function(this: Element, t: string): boolean {
          const rv = innerHTML.set.call(this, t);
          const cn = this.childNodes;
          if (getProxyStatus(cn) === ProxyStatus.IS_PROXY) {
            const stacks = getProxyStackTraces(cn);
            stacks.clear();
            _initializeMap(cn, stacks, _getStackTrace());
          }
          cn.$$$REINSTRUMENT$$$();
          return rv;
        },
        configurable: true,
        enumerable: true
      });

      const outerHTML = Object.getOwnPropertyDescriptor(Element.prototype, 'outerHTML');
      Object.defineProperty(Element.prototype, 'outerHTML', {
        get: outerHTML.get,
        set: function(this: Element, v: string): boolean {
          const parent = this.parentNode;
          if (parent) {
            const parentCn = parent.childNodes;
            if (getProxyStatus(parentCn) === ProxyStatus.IS_PROXY) {
              const len = parentCn.length;
              let i = 0;
              for (; i < len; i++) {
                if (parentCn[i] === this) {
                  break;
                }
              }
              if (i === len) {
                logToConsole(`Invalid call to outerHTML: Detached node?`);
              } else {
                const stacks = getProxyStackTraces(parentCn);
                _removeStacks(stacks, `${i}`);
                _addStackTrace(stacks, `${i}`);
              }
            }
          }
          const rv = outerHTML.set.call(this, v);
          if (parent) {
            parent.childNodes.$$$REINSTRUMENT$$$();
          }
          return rv;
        },
        configurable: true,
        enumerable: true
      });

      function insertAdjacentHelper(e: Element, position: InsertPosition): void {
        switch (position) {
          case 'beforebegin':
          case 'afterend': {
            if (e.parentNode && getProxyStatus(e.parentNode.childNodes) === ProxyStatus.IS_PROXY) {
              const parent = e.parentNode;
              const siblings = parent.childNodes;
              const numSiblings = siblings.length;
              let i = 0;
              for (; i < numSiblings; i++) {
                if ($$$SEQ$$$(siblings[i], e)) {
                  break;
                }
              }
              if (i !== numSiblings) {
                // Does it shift things down before or after this element?
                let start = position === 'beforebegin' ? i : i + 1;
                const stacks = getProxyStackTraces(siblings);
                for (i = numSiblings - 1; i >= start; i--) {
                  _copyStacks(stacks, `${i}`, `${i + 1}`)
                }
                _removeStacks(stacks, `${start}`);
                _addStackTrace(stacks, `${start}`);
              }
            }
            break;
          }
          case 'afterbegin':
          case 'beforeend': {
            const cn = e.childNodes;
            if (getProxyStatus(cn) === ProxyStatus.IS_PROXY) {
              const numChildren = cn.length;
              const stacks = getProxyStackTraces(cn);
              if (position === 'afterbegin') {
                for (let i = numChildren - 1; i >= 0; i--) {
                  _copyStacks(stacks, `${i}`, `${i + 1}`);
                }
                _removeStacks(stacks, `0`);
                _addStackTrace(stacks, `0`);
              } else {
                _addStackTrace(stacks, `${numChildren}`);
              }
            }
            break;
          }
        }
      }

      const insertAdjacentElement = Element.prototype.insertAdjacentElement;
      Element.prototype.insertAdjacentElement = function(position: InsertPosition, insertedElement: Element): Element {
        /**
         * The insertAdjacentElement() method inserts a given element node at a given
         * position relative to the element it is invoked upon.
         */
        insertAdjacentHelper(this, position);

        const rv = insertAdjacentElement.call(this, position, insertedElement);
        if (position === 'afterbegin' || position === 'beforeend') {
          this.childNodes.$$$REINSTRUMENT$$$();
        } else if (this.parentNode) {
          this.parentNode.childNodes.$$$REINSTRUMENT$$$();
        }
        return rv;
      };

      const insertAdjacentHTML = Element.prototype.insertAdjacentHTML;
      Element.prototype.insertAdjacentHTML = function(this: Element, where: InsertPosition, html: string): void {
        insertAdjacentHelper(this, where);
        const rv = insertAdjacentHTML.call(this, where, html);
        if (where === 'afterbegin' || where === 'beforeend') {
          this.childNodes.$$$REINSTRUMENT$$$();
        } else if (this.parentNode) {
          this.parentNode.childNodes.$$$REINSTRUMENT$$$();
        }
        return rv;
      };

      const insertAdjacentText = Element.prototype.insertAdjacentText;
      Element.prototype.insertAdjacentText = function(this: Element, where: InsertPosition, text: string): void {
        insertAdjacentHelper(this, where);
        const rv = insertAdjacentText.call(this, where, text);
        if (where === 'afterbegin' || where === 'beforeend') {
          this.childNodes.$$$REINSTRUMENT$$$();
        } else if (this.parentNode) {
          this.parentNode.childNodes.$$$REINSTRUMENT$$$();
        }
        return rv;
      }

      const remove = Element.prototype.remove;
      Element.prototype.remove = function(this: Element): void {
        const parent = this.parentNode;
        if (parent) {
          parent.removeChild(this);
        } else {
          remove.call(this);
        }
      };
      // Element:
      // **SPECIAL**: dataset - modifies properties on DOM object through object!!!!
      // -> throw exception if used.

      // SVGElement:
      // dataset: Throw exception if used
    }



    /*(<any> root)['$$PRINTCOUNTS$$'] = function(): void {
      logToConsole(`API,GetCount,InvokedCount,SetCount`);
      countMap.forEach((v, k) => {
        if (v.get + v.set + v.invoked > 0) {
          logToConsole(`${k},${v.get},${v.invoked},${v.set}`);
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