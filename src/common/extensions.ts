/*
 * Contains types shared between BLeak agent and the rest
 * of the program. These are globally accessible throughout
 * the codebase, and prevent us from needing to use JavaScript
 * modules for the BLeak agent.
 */

interface Object {
  getOwnPropertyDescriptors(obj: any): PropertyDescriptor[];
}

/**
 * LeakRoot ID => stack traces.
 */
interface GrowingStackTraces {
  [id: number]: string[];
}

/**
 * Represents the type of a heap path segment.
 */
const enum PathSegmentType {
  // Object property
  PROPERTY = 1,
  // Array element
  ELEMENT = 2,
  // Represents a closure object
  CLOSURE = 3,
  // Represents a variable within a closure
  CLOSURE_VARIABLE = 4,
  // Represents an event listener list. The next three path segments
  // contain the event listener type, index, and, finally, the listener
  // itself
  EVENT_LISTENER_LIST = 5,
  // Represents BLeak's special DOM tree mirror. The remaining
  // path is through the DOM (until it hits a 'root' property)
  DOM_TREE = 6,
  // Unknown.
  UNKNOWN = 7
}

/**
 * Represents a segment in a heap path.
 */
interface IPathSegment {
  type: PathSegmentType;
  indexOrName: string | number;
}

/**
 * Represents multiple heap paths, in tree form.
 * Convenient for sending to the web page for instrumentation.
 */
type IPathTree = IPathTreeGrowing | IPathTreeNotGrowing;

interface IPathTreeNotGrowing extends IPathSegment {
  isGrowing: false;
  children: IPathTree[];
}

interface IPathTreeGrowing extends IPathSegment {
  isGrowing: true;
  children: IPathTree[];
  // ID of the leak root at this path.
  id: number;
}

/**
 * List of growing paths from the global window objects, expressed in
 * tree form.
 */
type IPathTrees = IPathTree[];
