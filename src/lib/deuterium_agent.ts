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
  // Alternative store of DOM objects to facilitate fetching them. Heap snapshots treat DOM nodes weirdly.
  const domObjects: {[xpath: string]: Node} = {};
  window.$$domObjects = domObjects;

  function isHTMLElement(el: any): el is HTMLElement {
    return !!el.hasAttribute;
  }

  /**
   * Remove stale DOM objects from domObjects, allowing them to be GC'd.
   */
  function cleanDOMObjects() {
    for (const xpath in domObjects) {
      // Check if path has changed.
      const n = domObjects[xpath];
      const newPath = getDOMPath(n);
      if (newPath) {
        if (newPath !== xpath) {
          domObjects[newPath] = n;
        } else {
          // Node hasn't moved (common case); continue loop.
          continue;
        }
      }
      // Node is no longer at xpath. Check if path is valid.
      // Refresh node value, as it may have changed.
      const currentNode = document.querySelector(xpath);
      if (currentNode) {
        domObjects[xpath] = currentNode;
      } else {
        // xpath is no longer valid.
        delete domObjects[xpath];
      }
    }
  }

  setInterval(cleanDOMObjects, 2000);

  /**
   * Get a string path to the given node. It's a heuristic match.
   *
   * Modified from http://stackoverflow.com/a/16742828
   * @param el The HTML element.
   */
  function getDOMPath(el: Node): string | null {
    const stack: string[] = [];
    while (el.parentNode) {
      // console.log(el.nodeName);
      let sibCount = 0;
      let sibIndex = 0;
      let siblings = el.parentNode.childNodes;
      for (let i = 0; i < siblings.length; i++ ) {
        var sib = siblings[i];
        if (sib.nodeName == el.nodeName) {
          if (sib === el) {
            sibIndex = sibCount;
          }
          sibCount++;
        }
      }
      if (isHTMLElement(el) && el.hasAttribute('id') && el.id) {
        stack.unshift(el.nodeName.toLowerCase() + '#' + el.id);
      } else if (sibCount > 1) {
        stack.unshift(el.nodeName.toLowerCase() + ':nth-of-type(' + sibIndex + 1 + ')');
      } else {
        stack.unshift(el.nodeName.toLowerCase());
      }
      el = el.parentNode;
    }

    const html = stack[0];
    if (html === "html") {
      // slice(1) removes HTML element.
      return stack.slice(1).join(' ');
    }
    return null;
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
    if (this instanceof Node) {
      const n = <Node> this;
      const p = getDOMPath(n);
      domObjects[p] = n;
    }
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
      new Function('proxy', `${p} = proxy;`)(proxy);
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

  window.$$instrumentPaths = instrumentPaths;
  window.$$getStackTraces = getStackTraces;
})();