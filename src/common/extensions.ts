interface PromiseLike<T> {
  catch(cb: Function): PromiseLike<T>;
}

interface Function {
  __closure__(name: string): any;
  __closureAssign__(name: string, value: any): void;
}

interface Window {
  $$instrumentPaths(p: SerializeableGCPath[]): void;
  $$getStackTraces(): string;
  $$domObjects: any;
}

/**
 * A path to an object from a GC root.
 */
interface SerializeableGCPath {
  root: SerializeableRoot;
  path: SerializeableEdge[];
}

const enum RootType {
  GLOBAL = 0,
  DOM = 1
}

type SerializeableRoot = SerializeableGlobalRoot | SerializeableDOMRoot;

interface SerializeableGlobalRoot {
  type: RootType.GLOBAL;
}

interface SerializeableDOMRoot {
  type: RootType.DOM;
  elementType: string;
}

interface SerializeableEdge {
  type: EdgeType;
  indexOrName: string | number;
}

const enum EdgeType {
  INDEX = 0,
  NAMED = 1,
  CLOSURE = 2
}
