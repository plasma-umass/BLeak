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
  $$$INSTRUMENT_PATHS$$$(p: SerializeableGrowthObject[]): void;
  $$$GET_STACK_TRACE$$$(): string;
  $$$CREATE_SCOPE_OBJECT$$$(parentScopeObject: Scope, movedVariables: string[], unmovedVariables: PropertyDescriptorMap, args: string[], argValues: any[]): Scope;
  $$$SEQ$$$(a: any, b: any): boolean;
  $$$EQ$$$(a: any, b: any): boolean;
  $$$SHOULDFIX$$$(n: number): boolean;
  $$$GLOBAL$$$: Window;
}

/**
 * A path to an object from a GC root.
 */
interface SerializeableGCPath {
  root: SerializeableRoot;
  path: SerializeableEdge[];
}

/**
 * Describes a set of paths that typically point to the same leaking object.
 */
interface SerializeableGrowthObject {
  id: number;
  paths: SerializeableGCPath[];
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
