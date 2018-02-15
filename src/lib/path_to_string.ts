import {IPath} from '../common/interfaces';

const r = /'/g;
/**
 * Escapes single quotes in the given string.
 * @param s
 */
function safeString(s: string): string {
  return s.replace(r, "\\'");
}

// From https://stackoverflow.com/a/2008444
// This is not *perfect*, but it's good enough for human output.
const JS_IDENTIFIER_REGEXP = /^[_$a-zA-Z\xA0-\uFFFF][_$a-zA-Z0-9\xA0-\uFFFF]*$/;
/**
 * Returns true if the property definitely requires array notation.
 * This check is not sound, as we do not check for JavaScript reserved
 * words. However, it is 'good enough' for human output, e.g. in a report.
 * @param prop
 */
function propertyNeedsArrayNotation(prop: string | number): boolean {
  return !JS_IDENTIFIER_REGEXP.test(`${prop}`);
}

function propertyAccessString(s: string | number) {
  if (typeof(s) === "number") {
    return `[${s}]`;
  } else if (propertyNeedsArrayNotation(s)) {
    return `["${safeString(s)}"]`;
  } else {
    return `.${s}`;
  }
}

function prettyPrintDOMPath(): void {
  while (PS.nonempty()) {
    const segment = PS.pop();
    const name = segment.indexOrName;
    if (name === "root") {
      // Ignore this BLeak-inserted edge.
      // We're transitioning to a path outside of the DOM, on the DOM object itself.
      prettyPrintNonDOMPath();
    } else if (name === 'childNodes') {
      PS.print(propertyAccessString(name));
    } else {
      // $$$CHILD$$$n => n
      const idx = parseInt((name as string).slice(11), 10);
      // Should alternate between 'childNode' and indices until it gets to 'root'.
      PS.print(propertyAccessString(idx));
    }
  }
}

function prettyPrintNonDOMPath(): void {
  while (PS.nonempty()) {
    const segment = PS.pop();
    switch (segment.type) {
      case PathSegmentType.EVENT_LISTENER_LIST: {
        // Will either be:
        // - A leak on the list itself.
        // - A leak *within* an event listener.
        // Seek forward to figure out which, and print appropriately
        // $$listeners.type[index].listener
        const typeSegment = PS.pop();
        if (!PS.nonempty()) {
          // List leak
          PS.pushString();
          PS.print(`List of '${typeSegment.indexOrName}' listeners on`);
          PS.pushString();
        } else {
          const indexSegment = PS.pop();
          PS.pop(); // Should be the '.listener' property, unless the application mucked with our metadata.
          PS.pushString();
          PS.print(`on listener ${indexSegment.indexOrName} in the list of '${typeSegment.indexOrName}' listeners on`);
          PS.pushString();
        }
        break;
      }
      case PathSegmentType.CLOSURE:
        PS.pushString();
        PS.print("within closure of");
        PS.pushString();
        break;
      case PathSegmentType.CLOSURE_VARIABLE:
        // Should've been preceded by CLOSURE.
        // Begins a new path in the string.
        PS.print(segment.indexOrName as string);
        break;
      default: {
        let indexOrName = segment.indexOrName;
        if (typeof(indexOrName) === "string" && indexOrName.startsWith("$$$on")) {
          // Cut off the $$$. This is a mirrored event listener property.
          indexOrName = indexOrName.slice(3);
        }
        // *Must* be a property on the previously-printed object.
        PS.print(propertyAccessString(indexOrName));
        break;
      }
    }
  }
}

class PathStream {
  private _p: IPath = null;
  private _i: number = -1;
  private _s: string = null;
  private _ss: string[] = null;
  public print(s: string) {
    if (this._s !== null) {
      this._s += s;
    }
  }
  public pushString() {
    if (this._ss !== null) {
      this._ss.push(this._s);
      this._s = "";
    }
  }
  public flush(): string {
    const s = this._s;
    const ss = this._ss;
    this._ss = this._s = null;
    ss.push(s);
    return ss.filter((s) => s !== "").reverse().join(" ");
  }
  public setPath(p: IPath) {
    this._p = p;
    this._i = 0;
    this._s = "";
    this._ss = [];
  }
  public advance(): void {
    this._i++;
  }
  public peek(): IPathSegment | null {
    if (this.nonempty()) {
      return this._p[this._i];
    } else {
      return null;
    }
  }
  public pop(): IPathSegment | null {
    const rv = this.peek();
    this.advance();
    return rv;
  }
  public nonempty(): boolean {
    return this._p && this._p.length > this._i;
  }
}
// Singleton class.
const PS = new PathStream();

/**
 * Pretty print a path as a human-friendly string.
 * @param p
 */
export default function pathToString(p: IPath): string {
  PS.setPath(p);
  const segment = PS.peek();
  if (segment.type === PathSegmentType.DOM_TREE) {
    PS.print("document");
    PS.advance();
    prettyPrintDOMPath();
  } else {
    PS.print("window");
    prettyPrintNonDOMPath();
  }
  return PS.flush();
}
