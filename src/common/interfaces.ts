/**
 * Contains information on a source file.
 */
interface SourceFile {
  url: string;
  mimetype: string;
  contents: string;
}

interface Function {
  __closure__(): {[name: string]: any};
}

/**
 * Describes a mutation of a source file.
 */
interface ClosureModification {
  // Source string of function.
  source: string;
  // Variables to surface in closure.
  variables: string[];
}

/**
 * Drives the application on behalf of Deuterium Oxide.
 */
interface AppDriver extends NodeJS.EventEmitter {
  /**
   * Register a function that can rewrite *text* files requested over the network.
   */
  registerRewriter(fcn: (f: SourceFile) => SourceFile): void;
  /**
   * Navigates to the given URL. Invokes promise once page loads.
   */
  navigateTo(url: string): Promise<void>;
  /**
   * Evals the given code on the webpage, and returns result as a string.
   */
  runCode(code: string): Promise<string>;
  /**
   * Takes a heap snapshot of the current webpage.
   */
  takeHeapSnapshot(): Promise<HeapSnapshot>;
}

/**
 * A Deuterium Oxide configuration file.
 */
interface ConfigurationFile {
  // URL to web page to check for memory leaks.
  url: string;
  // (Optional) Globs for script files that should be *black boxed* during leak detection.
  blackBox?: string[];
  // Runs your program in a loop. Each step has a "check" function, and a "next" function
  // to transition to the next step in the loop.
  // Deuterium oxide assumes your program is in the first step when it navigates to the URL,
  // and that the last step transitions to the first step.
  loop: Step[];
  // (Optional) How long to wait for a step transition to finish before declaring an error.
  timeout?: number;
}

/**
 * A stage in an application loop.
 */
interface Step  {
  // (Optional) Name for debugging purposes.
  name?: string;
  // Return 'true' if the program has finished loading the current state
  check: () => boolean | Promise<boolean>;
  // Transitions to the next step.
  next: () => null | undefined | Promise<void>;
}

/**
 * Represents a leak in the application.
 */
interface Leak {
  propertyPath: string[];
  stackTraces: string[][];
}

/**
 * Chrome heap snapshot.
 */
interface HeapSnapshot {
  snapshot: HeapSnapshotContents;
  nodes: number[];
  edges: number[];
  trace_function_info: any[];
  trace_tree: any[];
  samples: any[];
  strings: string[];
}

interface HeapSnapshotContents {
  meta: HeapSnapshotMeta;
  node_count: number;
  edge_count: number;
  trace_function_count: number;
}

interface HeapSnapshotMeta {
  node_fields: string[];
  node_types: (string | string[])[];
  edge_fields: string[];
  edge_types: (string | string[])[];
  trace_function_info_fields: string[];
  trace_node_fields: string[];
  sample_fields: string[];
}