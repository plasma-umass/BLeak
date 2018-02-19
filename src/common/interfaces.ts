/**
 * A BLeak configuration file.
 */
export interface IBLeakConfig {
  /** REQUIRED **/

  // URL to web page to check for memory leaks.
  url: string;
  // Runs your program in a loop. Each step has a "check" function, and a "next" function
  // to transition to the next step in the loop.
  loop: Step[];

  /** OPTIONAL **/

  // Number of iterations to do
  iterations: number;
  // Number of iterations to perform during a ranking evaluation.
  rankingEvaluationIterations: number;
  // Number of runs to perform during a ranking evaluation.
  rankingEvaluationRuns: number;
  // Leaks to consider "fixed" during run.
  fixedLeaks: number[];
  // Maps leak roots back to distinct leak fixes, identified by their first heap path. Used to evaluate different ranking metrics.
  fixMap: {[leakRoot: string]: number};
  login: Step[];
  setup: Step[];
  // How long (in milliseconds) to wait for a step transition to finish before declaring an error.
  // Default: 10 minutes (10 * 60 * 1000)
  timeout: number;
  rewrite: (url: string, type: string, source: Buffer, fixes: number[]) => Buffer;

  // How long (in milliseconds) to wait between a check() returning 'true' and transitioning to the next step or taking a heap snapshot.
  // Default: 1000
  postCheckSleep: number;
  // How long (in milliseconds) to wait between transitioning to the next step and running check() for the first time.
  // Default: 0
  postNextSleep: number;
  // How long (in milliseconds) to wait between submitting login credentials and reloading the page for a run.
  // Default: 5000
  postLoginSleep: number;
}

export type StepType = "login" | "setup" | "loop";

/**
 * A stage in an application loop.
 */
export interface Step  {
  // Return 'true' if the program has finished loading the current state
  check: () => boolean;
  // Transitions to the next step.
  next: () => null | undefined;
}

/**
 * Chrome heap snapshot.
 */
export interface HeapSnapshot {
  snapshot: HeapSnapshotContents;
  nodes: number[];
  edges: number[];
  trace_function_info: any[];
  trace_tree: any[];
  samples: any[];
  strings: string[];
}

export interface HeapSnapshotContents {
  meta: HeapSnapshotMeta;
  node_count: number;
  edge_count: number;
  trace_function_count: number;
  root_index?: number;
}

export interface HeapSnapshotMeta {
  node_fields: string[];
  node_types: (string | string[])[];
  edge_fields: string[];
  edge_types: (string | string[])[];
  trace_function_info_fields: string[];
  trace_node_fields: string[];
  sample_fields: string[];
}

/**
 * The type of a heap snapshot edge.
 * Copied from `v8-profiler.h`.
 */
export const enum SnapshotEdgeType {
  ContextVariable = 0,  // A variable from a function context.
  Element = 1,          // An element of an array.
  Property = 2,         // A named object property.
  Internal = 3,         // A link that can't be accessed from JS,
                        // thus, its name isn't a real property name
                        // (e.g. parts of a ConsString).
  Hidden = 4,           // A link that is needed for proper sizes
                        // calculation, but may be hidden from user.
  Shortcut = 5,         // A link that must not be followed during
                        // sizes calculation.
  Weak = 6              // A weak reference (ignored by the GC).
}

export function SnapshotEdgeTypeToString(se: SnapshotEdgeType): string {
  switch (se) {
    case SnapshotEdgeType.ContextVariable:
      return "ContextVariable";
    case SnapshotEdgeType.Element:
      return "Element";
    case SnapshotEdgeType.Hidden:
      return "Hidden";
    case SnapshotEdgeType.Internal:
      return "Internal";
    case SnapshotEdgeType.Property:
      return "Property";
    case SnapshotEdgeType.Shortcut:
      return "Shortcut";
    case SnapshotEdgeType.Weak:
      return "Weak";
    default:
      return "(Unknown)";
  }
}

/**
 * The type of a heap snapshot node.
 * Copied from `v8-profiler.h`.
 */
export const enum SnapshotNodeType {
  Hidden = 0,         // Hidden node, may be filtered when shown to user.
  Array = 1,          // An array of elements.
  String = 2,         // A string.
  Object = 3,         // A JS object (except for arrays and strings).
  Code = 4,           // Compiled code.
  Closure = 5,        // Function closure.
  RegExp = 6,         // RegExp.
  HeapNumber = 7,     // Number stored in the heap.
  Native = 8,         // Native object (not from V8 heap).
  Synthetic = 9,      // Synthetic object, usualy used for grouping
                      // snapshot items together.
  ConsString = 10,    // Concatenated string. A pair of pointers to strings.
  SlicedString = 11,  // Sliced string. A fragment of another string.
  Symbol = 12,        // A Symbol (ES6).
  Unresolved = 15     // (Internal) Not resolved yet.
}

/**
 * A summary of a heap snapshot's size
 */
export interface SnapshotSizeSummary {
  numNodes: number;
  numEdges: number;
  totalSize: number;
  hiddenSize: number;
  arraySize: number;
  stringSize: number;
  objectSize: number;
  codeSize: number;
  closureSize: number;
  regexpSize: number;
  heapNumberSize: number;
  nativeSize: number;
  syntheticSize: number;
  consStringSize: number;
  slicedStringSize: number;
  symbolSize: number;
  unknownSize: number;
}

export function SnapshotNodeTypeToString(sn: SnapshotNodeType): string {
  switch (sn) {
    case SnapshotNodeType.Array:
      return "Array";
    case SnapshotNodeType.Closure:
      return "Closure";
    case SnapshotNodeType.Code:
      return "Code";
    case SnapshotNodeType.ConsString:
      return "ConsString";
    case SnapshotNodeType.HeapNumber:
      return "HeapNumber";
    case SnapshotNodeType.Hidden:
      return "Hidden";
    case SnapshotNodeType.Native:
      return "Native";
    case SnapshotNodeType.Object:
      return "Object";
    case SnapshotNodeType.RegExp:
      return "RegExp";
    case SnapshotNodeType.SlicedString:
      return "SlicedString";
    case SnapshotNodeType.String:
      return "String";
    case SnapshotNodeType.Symbol:
      return "Symbol";
    case SnapshotNodeType.Synthetic:
      return "Synthetic";
    case SnapshotNodeType.Unresolved:
      return "Unresolved";
    default:
      return "(Unknown)";
  }
}

// rankingEvaluation[rankingName][top n fixed][run] => heap size over time
export interface RankingEvaluation {
  transitiveClosureSize: SnapshotSizeSummary[][][];
  leakShare: SnapshotSizeSummary[][][];
  retainedSize: SnapshotSizeSummary[][][];
}

/**
 * The raw output of BLeak, as a JSON object.
 */
export interface IBLeakResults {
  // A listing of memory leaks in no particular order.
  leaks: ILeakRoot[];
  // All unique stack frames.
  stackFrames: IStackFrame[];
  // The program's original source files.
  sourceFiles: ISourceFileRepository;
  // Heap statistics, broken down by iteration.
  heapStats: SnapshotSizeSummary[];
  // Performance of different rankings.
  rankingEvaluation: RankingEvaluation;
}

/**
 * Represents a single leak root.
 */
export interface ILeakRoot {
  // Unique ID for this leak root.
  id: number;
  // Paths through the heap to this leak.
  paths: IPath[];
  scores: ILeakScores;
  stacks: IStack[];
}

/**
 * Represents a heap path.
 */
export type IPath = IPathSegment[];

/**
 * Contains various leak scores for a given memory leak.
 */
export interface ILeakScores {
  transitiveClosureSize: number;
  leakShare: number;
  retainedSize: number;
  ownedObjects: number;
}

/**
 * Contains a collection of source files, indexed by URL.
 */
export interface ISourceFileRepository {
  [url: string]: ISourceFile;
}

/**
 * Represents a single source file. Must be JavaScript or HTML.
 */
export interface ISourceFile {
  mimeType: "text/javascript" | "text/html";
  source: string;
}

/**
 * Represents a stack frame in a concise JSON format.
 * [url, line, column, functionName, source]
 */
export type IStackFrame = [string, number, number, string, string];

/**
 * Represents a stack trace. Each number is an offset into the stackFrames array.
 */
export type IStack = number[];

/**
 * Logging interface. Specified so that `console` satisfies this interface.
 */
export interface Log {
  // A debug println.
  debug(data: string): void;
  // A regular println.
  log(data: string): void;
  // Print an error
  error(data: string): void;
}

/**
 * Interface for a progress bar.
 */
export interface IProgressBar extends Log {
  // Proceed to the next operation.
  nextOperation(): void;
  // Go to 100% complete, regardless of current completion amount.
  finish(): void;
  // Abort the progress bar due to a fatal error.
  abort(): void;
  // Update the current description w/o moving the progress bar.
  updateDescription(desc: string): void;
  // The total number of operations that need to be performed.
  setOperationCount(count: number): void;
}

/**
 * Indicates an item's growth status.
 * **MUST FIT INTO 2 BITS.** (Value <= 3)
 */
export const enum GrowthStatus {
  NEW = 0,
  NOT_GROWING = 1,
  GROWING = 2
}
