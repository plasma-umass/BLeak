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
  $$$INSTRUMENT_PATHS$$$(p: SerializeableGrowingPaths): void;
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

interface Object {
  getOwnPropertyDescriptors(obj: any): PropertyDescriptor[];
}

/**
 * ID => stack traces.
 */
interface GrowingStackTraces {
  [id: number]: string[];
}

/**
 * A tree of growing GC paths from the global window object.
 */
interface SerializeableGrowingPathTree {
  type: EdgeType;
  indexOrName: string | number;
  isGrowing: boolean;
  children: SerializeableGrowingPathTree[];
  id?: number; // ID of growing object at path.
}

/**
 * List of growing paths from the global window objects, expressed in
 * tree form.
 */
type SerializeableGrowingPaths = SerializeableGrowingPathTree[];

const enum EdgeType {
  INDEX = 0,
  NAMED = 1,
  // CLOSURE = 2
}

/**
 * Indicates an item's growth status.
 * **MUST FIT INTO 2 BITS.** (Value <= 3)
 */
const enum GrowthStatus {
  NEW = 0,
  NOT_GROWING = 1,
  GROWING = 2
}