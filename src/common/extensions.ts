interface PromiseLike<T> {
  catch(cb: Function): PromiseLike<T>;
}

interface Object {
  $$$PROXY$$$?: any;
}

interface Scope {
  [ident: string]: any;
}

interface Function {
  __scope__: Scope;
}

interface Window {
  $$instrumentPaths(p: SerializeableGCPath[][]): void;
  $$getStackTraces(): string;
  $$addStackTrace(map: Map<string | symbol | number, Set<string>>, property: string | number | symbol): void;
  $$getProxy(obj: any, map: Map<string | number | symbol, Set<string>>): any;
  $$CREATE_SCOPE_OBJECT$$(parentScopeObject: Scope, movedVariables: string[], unmovedVariables: PropertyDescriptorMap, args: string[], argValues: any[]): Scope;
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
