import {SnapshotEdgeType, SnapshotNodeType, SnapshotSizeSummary, ILeakRoot, IPath, GrowthStatus} from '../common/interfaces';
import {default as HeapSnapshotParser, DataTypes} from './heap_snapshot_parser';
import {OneBitArray, TwoBitArray} from '../common/util';
import LeakRoot from './leak_root';

/**
 * Represents a link in a heap path. Specified as a simple class to make it quick to consturct and JSONable.
 * TODO: Better terminology?
 */
class PathSegment implements IPathSegment {
  constructor(public readonly type: PathSegmentType,
    public readonly indexOrName: string | number) {}
}

/**
 * Converts an edge into a heap path segment.
 * @param edge
 */
function edgeToIPathSegment(edge: Edge): IPathSegment {
  const pst = edge.pathSegmentType;
  const name = pst === PathSegmentType.CLOSURE ? "__scope__" : edge.indexOrName;
  return new PathSegment(edge.pathSegmentType, name);
}

/**
 * Converts a sequence of edges from the heap graph into an IPath object.
 * @param edges
 */
function edgePathToPath(edges: Edge[]): IPath {
  return edges.filter(isNotHidden).map(edgeToIPathSegment);
}

/**
 * Returns true if the given edge type is visible from JavaScript.
 * @param edge
 */
function isNotHidden(edge: Edge): boolean {
  switch(edge.snapshotType) {
    case SnapshotEdgeType.Internal:
      // Keep around closure edges so we can convert them to __scope__.
      return edge.indexOrName === "context";
    case SnapshotEdgeType.Hidden:
    case SnapshotEdgeType.Shortcut:
      return false;
    default:
      return true;
  }
}

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
    return ss.reverse().join(" ");
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
  const segment = PS.pop();
  while (PS.nonempty()) {
    if (segment.indexOrName === "root") {
      // Ignore this BLeak-inserted edge.
      // We're transitioning to a path outside of the DOM, on the DOM object itself.
      prettyPrintNonDOMPath();
    } else {
      // Should alternate between 'childNode' and indices until it gets to 'root'.
      PS.print(propertyAccessString(segment.indexOrName));
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

/**
 * Pretty print a path as a human-friendly string.
 * @param p
 */
export function pathToString(p: IPath): string {
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

/**
 * Extracts a tree of growing heap paths from a series of leak roots and
 * paths to said roots.
 *
 * Called before sending the leak roots to the BLeak agent for instrumentation.
 */
export function toPathTree(leakroots: ILeakRoot[]): IPathTrees {
  const tree: IPathTrees = [];

  function addPath(p: IPath, id: number, index = 0, children = tree): void {
    if (p.length === 0) {
      return;
    }
    const pathSegment = p[index];
    const indexOrName = pathSegment.indexOrName;
    const matches = children.filter((c) => c.indexOrName === indexOrName);
    let recur: IPathTree;
    if (matches.length > 0) {
      recur = matches[0];
    } else {
      // Add to children list.
      recur = <IPathTreeNotGrowing> Object.assign({
        isGrowing: false,
        children: []
      }, pathSegment);
      children.push(recur);
    }
    const next = index + 1;
    if (next === p.length) {
      (recur as IPathTreeGrowing).isGrowing = true;
      (recur as IPathTreeGrowing).id = id;
    } else {
      addPath(p, id, next, recur.children);
    }
  }

  leakroots.forEach((lr) => {
    lr.paths.forEach((p) => {
      addPath(p, lr.id);
    });
  });

  return tree;
}

// Edge brand
type EdgeIndex = number & { ___EdgeIndex: true };
// Node brand
type NodeIndex = number & { ___NodeIndex: true };

function shouldTraverse(edge: Edge, wantDom: boolean): boolean {
  // HACK: Ignore <symbol> properties. There may be multiple properties
  // with the name <symbol> in a heap snapshot. There does not appear to
  // be an easy way to disambiguate them.
  if (edge.indexOrName === "<symbol>") {
    return false;
  }
  if (edge.snapshotType === SnapshotEdgeType.Internal) {
    // Whitelist of internal edges we know how to follow.
    switch (edge.indexOrName) {
      case "elements":
      case "table":
      case "properties":
      case "context":
        return true;
      default:
        return wantDom && edge.to.name.startsWith("Document DOM");
    }
  } else if (edge.to.type === SnapshotNodeType.Synthetic) {
    return edge.to.name === "(Document DOM trees)";
  }
  return true;
}

/**
 * Returns a hash representing a particular edge as a child of the given parent.
 * @param parent
 * @param edge
 */
function hash(parent: Node, edge: Edge): string | number {
  if (parent.type === SnapshotNodeType.Synthetic) {
    return edge.to.name;
  } else {
    return edge.indexOrName;
  }
}

/**
 * PropagateGrowth (Figure 4 in the paper).
 * Migrates a node's growth between heap snapshots. BLeak considers a path in the heap to be growing
 * if the node at the path exhibits sustained growth (in terms of number of outgoing edges) between heap
 * snapshots.
 * @param oldG The old heap graph.
 * @param oldGrowth Growth bits for the nodes in the old heap graph.
 * @param newG The new heap graph.
 * @param newGrowth Growth bits for the nodes in the new heap graph.
 */
function propagateGrowth(oldG: HeapGraph, oldGrowth: TwoBitArray, newG: HeapGraph, newGrowth: TwoBitArray): void {
  const numNewNodes = newG.nodeCount;
  let index = 0;
  // We visit each new node at most once, forming an upper bound on the queue length.
  // Pre-allocate for better performance.
  let queue = new Uint32Array(numNewNodes << 1);
  // Stores the length of queue.
  let queueLength = 0;
  // Only store visit bits for the new graph.
  const visitBits = new OneBitArray(numNewNodes);

  // Enqueues the given node pairing (represented by their indices in their respective graphs)
  // into the queue. oldNodeIndex and newNodeIndex represent a node at the same edge shared between
  // the graphs.
  function enqueue(oldNodeIndex: NodeIndex, newNodeIndex: NodeIndex): void {
    queue[queueLength++] = oldNodeIndex;
    queue[queueLength++] = newNodeIndex;
  }

  // Returns a single item from the queue. (Called twice to remove a pair.)
  function dequeue(): NodeIndex {
    return queue[index++] as NodeIndex;
  }

  // 0 indicates the root node. Start at the root.
  const oldNode = new Node(0 as NodeIndex, oldG);
  const newNode = new Node(0 as NodeIndex, newG);
  const oldEdgeTmp = new Edge(0 as EdgeIndex, oldG);

  {
    // Visit global roots by *node name*, not *edge name* as edges are arbitrarily numbered from the root node.
    // These global roots correspond to different JavaScript contexts (e.g. IFrames).
    const newUserRoots = newG.getGlobalRootIndices();
    const oldUserRoots = oldG.getGlobalRootIndices();
    const m = new Map<string, {o: number[], n: number[]}>();
    for (let i = 0; i < newUserRoots.length; i++) {
      newNode.nodeIndex = <any> newUserRoots[i];
      const name = newNode.name;
      let a = m.get(name);
      if (!a) {
        a = {o: [], n: []};
        m.set(name, a);
      }
      a.n.push(newUserRoots[i]);
    }
    for (let i = 0; i < oldUserRoots.length; i++) {
      oldNode.nodeIndex = <any> oldUserRoots[i];
      const name = oldNode.name;
      let a = m.get(name);
      if (a) {
        a.o.push(oldUserRoots[i]);
      }
    }

    m.forEach((v) => {
      let num = Math.min(v.o.length, v.n.length);
      for (let i = 0; i < num; i++) {
        enqueue(<any> v.o[i], <any> v.n[i]);
        visitBits.set(v.n[i], true);
      }
    });
  }

  // The main loop, which is the essence of PropagateGrowth.
  while (index < queueLength) {
    const oldIndex = dequeue();
    const newIndex = dequeue();
    oldNode.nodeIndex = oldIndex;
    newNode.nodeIndex = newIndex;

    const oldNodeGrowthStatus: GrowthStatus = oldGrowth.get(oldIndex);

    // Nodes are either 'New', 'Growing', or 'Not Growing'.
    // Nodes begin as 'New', and transition to 'Growing' or 'Not Growing' after a snapshot.
    // So if a node is neither new nor consistently growing, we don't care about it.
    if ((oldNodeGrowthStatus === GrowthStatus.NEW || oldNodeGrowthStatus === GrowthStatus.GROWING) && oldNode.numProperties() < newNode.numProperties()) {
      newGrowth.set(newIndex, GrowthStatus.GROWING);
    }

    // Visit shared children.
    const oldEdges = new Map<string | number, EdgeIndex>();
    if (oldNode.hasChildren) {
      for (const it = oldNode.children; it.hasNext(); it.next()) {
        const oldChildEdge = it.item();
        oldEdges.set(hash(oldNode, oldChildEdge), oldChildEdge.edgeIndex);
      }
    }

    if (newNode.hasChildren) {
      for (const it = newNode.children; it.hasNext(); it.next()) {
        const newChildEdge = it.item();
        const oldEdge = oldEdges.get(hash(newNode, newChildEdge));
        oldEdgeTmp.edgeIndex = oldEdge;
        if (oldEdge !== undefined && !visitBits.get(newChildEdge.toIndex) &&
            shouldTraverse(oldEdgeTmp, false) && shouldTraverse(newChildEdge, false)) {
          visitBits.set(newChildEdge.toIndex, true);
          enqueue(oldEdgeTmp.toIndex, newChildEdge.toIndex);
        }
      }
    }
  }
}

/**
 * Tracks growth in the heap.
 */
export class HeapGrowthTracker {
  private _stringMap: StringMap = new StringMap();
  private _heap: HeapGraph = null;
  private _growthStatus: TwoBitArray = null;
  // DEBUG INFO; this information is shown in a heap explorer tool.
  public _leakRefs: Uint16Array = null;
  public _nonLeakVisits: OneBitArray = null;

  public async addSnapshot(parser: HeapSnapshotParser): Promise<void> {
    const heap = await HeapGraph.Construct(parser, this._stringMap);
    const growthStatus = new TwoBitArray(heap.nodeCount);
    if (this._heap !== null) {
      // Initialize all new nodes to 'NOT_GROWING'.
      // We only want to consider stable heap paths present from the first snapshot.
      growthStatus.fill(GrowthStatus.NOT_GROWING);
      // Merge graphs.
      propagateGrowth(this._heap, this._growthStatus, heap, growthStatus);
    }
    // Keep new graph.
    this._heap = heap;
    this._growthStatus = growthStatus;
  }

  public getGraph(): HeapGraph {
    return this._heap;
  }

  /**
   * Implements FindLeakPaths (Figure 5 in the paper) and CalculateLeakShare (Figure 6 in the paper),
   * as well as calculations for Retained Size and Transitive Closure Size (which we compare against in the paper).
   *
   * Returns paths through the heap to leaking nodes, along with multiple different types of scores to help
   * developers prioritize them, grouped by the leak root responsible.
   */
  public findLeakPaths(): LeakRoot[] {
    // A map from growing nodes to heap paths that reference them.
    const growthPaths = new Map<NodeIndex, Edge[][]>();

    // Adds a given path to growthPaths.
    function addPath(e: Edge[]): void {
      const to = e[e.length - 1].toIndex;
      let paths = growthPaths.get(to);
      if (paths === undefined) {
        paths = [];
        growthPaths.set(to, paths);
      }
      paths.push(e);
    }

    // Filter out DOM nodes and hidden edges that represent internal V8 / Chrome state.
    function filterNoDom(n: Node, e: Edge) {
      return isNotHidden(e) && nonWeakFilter(n, e) && shouldTraverse(e, false);
    }

    // Filter out hidden edges that represent internal V8 / Chrome state, but keep DOM nodes.
    function filterIncludeDom(n: Node, e: Edge) {
      return nonWeakFilter(n, e) && shouldTraverse(e, true);
    }

    // Get the growing paths. Ignore paths through the DOM, as we mirror those in JavaScript.
    // (See Section 5.3.2 in the paper, "Exposing Hidden State")
    this._heap.visitGlobalEdges((e, getPath) => {
      if (this._growthStatus.get(e.toIndex) === GrowthStatus.GROWING) {
        addPath(getPath());
      }
    }, filterNoDom);

    // Now, calculate growth metrics!

    // Mark items that are reachable by non-leaks.
    const nonleakVisitBits = new OneBitArray(this._heap.nodeCount);
    this._heap.visitUserRoots((n) => {
      nonleakVisitBits.set(n.nodeIndex, true);
    }, (n, e) => {
      // Filter out edges to growing objects.
      // Traverse the DOM this time.
      return filterIncludeDom(n, e) && !growthPaths.has(e.toIndex);
    });

    // Filter out items that are reachable from non-leaks.
    function nonLeakFilter(n: Node, e: Edge): boolean {
      return filterIncludeDom(n, e) && !nonleakVisitBits.get(e.toIndex);
    }

    // Increment visit counter for each heap item reachable from a leak.
    // Used by LeakShare.
    const leakReferences = new Uint16Array(this._heap.nodeCount);
    growthPaths.forEach((paths, growthNodeIndex) => {
      bfsVisitor(this._heap, [growthNodeIndex], (n) => {
        leakReferences[n.nodeIndex]++;
      }, nonLeakFilter);
    });

    // Calculate final growth metrics (LeakShare, Retained Size, Transitive Closure Size)
    // for each LeakPath, and construct LeakRoot objects representing each LeakRoot.
    let rv = new Array<LeakRoot>();
    growthPaths.forEach((paths, growthNodeIndex) => {
      let retainedSize = 0;
      let leakShare = 0;
      let transitiveClosureSize = 0;
      let ownedObjects = 0;
      bfsVisitor(this._heap, [growthNodeIndex], (n) => {
        const refCount = leakReferences[n.nodeIndex];
        if (refCount === 1) {
          // A refCount of 1 means the heap item is uniquely referenced by this leak,
          // so it contributes to retainedSize.
          retainedSize += n.size;
          ownedObjects++;
        }
        leakShare += n.size / refCount;
      }, nonLeakFilter);

      // Transitive closure size, for comparison to related work.
      bfsVisitor(this._heap, [growthNodeIndex], (n) => {
        transitiveClosureSize += n.size;
      }, filterIncludeDom);

      rv.push(new LeakRoot(growthNodeIndex, paths.map(edgePathToPath), {
        retainedSize,
        leakShare,
        transitiveClosureSize,
        ownedObjects
      }));
    });

    // DEBUG
    this._leakRefs = leakReferences;
    this._nonLeakVisits = nonleakVisitBits;

    return rv;
  }

  public isGrowing(nodeIndex: number): boolean {
    return this._growthStatus.get(nodeIndex) === GrowthStatus.GROWING;
  }
}


/**
 * Map from ID => string.
 */
class StringMap {
  private _map = new Map<string, number>();
  private _strings = new Array<string>();

  public get(s: string): number {
    const map = this._map;
    let id = map.get(s);
    if (id === undefined) {
      id = this._strings.push(s) - 1;
      map.set(s, id);
    }
    return id;
  }

  public fromId(i: number): string {
    return this._strings[i];
  }
}

/**
 * Edge mirror
 */
export class Edge {
  public edgeIndex: EdgeIndex;
  private _heap: HeapGraph;

  constructor(i: EdgeIndex, heap: HeapGraph) {
    this.edgeIndex = i;
    this._heap = heap;
  }
  public get to(): Node {
    return new Node(this._heap.edgeToNodes[this.edgeIndex], this._heap);
  }
  public get toIndex(): NodeIndex {
    return this._heap.edgeToNodes[this.edgeIndex];
  }
  public get snapshotType(): SnapshotEdgeType {
    return this._heap.edgeTypes[this.edgeIndex];
  }
  /**
   * Returns the index (number) or name (string) that this edge
   * corresponds to. (Index types occur in Arrays.)
   */
  public get indexOrName(): string | number {
    const nameOrIndex = this._heap.edgeNamesOrIndexes[this.edgeIndex];
    if (this._isIndex()) {
      return nameOrIndex;
    } else {
      return this._heap.stringMap.fromId(nameOrIndex);
    }
  }
  /**
   * Returns 'true' if the edge corresponds to a type where nameOrIndex is an index,
   * and false otherwise.
   */
  private _isIndex(): boolean {
    switch(this.snapshotType) {
      case SnapshotEdgeType.Element: // Array element.
      case SnapshotEdgeType.Hidden: // Hidden from developer, but influences in-memory size. Apparently has an index, not a name. Ignore for now.
        return true;
      case SnapshotEdgeType.ContextVariable: // Closure variable.
      case SnapshotEdgeType.Internal: // Internal data structures that are not actionable to developers. Influence retained size. Ignore for now.
      case SnapshotEdgeType.Shortcut: // Shortcut: Should be ignored; an internal detail.
      case SnapshotEdgeType.Weak: // Weak reference: Doesn't hold onto memory.
      case SnapshotEdgeType.Property: // Property on an object.
        return false;
      default:
        throw new Error(`Unrecognized edge type: ${this.snapshotType}`);
    }
  }
  /**
   * Determines what type of edge this is in a heap path.
   * Recognizes some special BLeak-inserted heap edges that correspond
   * to hidden browser state.
   */
  public get pathSegmentType(): PathSegmentType {
    switch(this.snapshotType) {
      case SnapshotEdgeType.Element:
        return PathSegmentType.ELEMENT;
      case SnapshotEdgeType.ContextVariable:
        return PathSegmentType.CLOSURE_VARIABLE;
      case SnapshotEdgeType.Internal:
        if (this.indexOrName === 'context') {
          return PathSegmentType.CLOSURE;
        }
        break;
      case SnapshotEdgeType.Property: {
        // We assume that no one uses our chosen special property names.
        // If the program happens to have a memory leak stemming from a non-BLeak-created
        // property with one of these names, then BLeak might not find it.
        const name = this.indexOrName;
        switch (name) {
          case '$$$DOM$$$':
            return PathSegmentType.DOM_TREE;
          case '$$listeners':
            return PathSegmentType.EVENT_LISTENER_LIST;
          default:
            return PathSegmentType.PROPERTY;
        }
      }
    }
    console.debug(`Unrecognized edge type: ${this.snapshotType}`)
    return PathSegmentType.UNKNOWN;
  }
}

class EdgeIterator {
  private _heap: HeapGraph;
  private _edge: Edge;
  private _edgeEnd: number;
  constructor(heap: HeapGraph, edgeStart: EdgeIndex, edgeEnd: EdgeIndex) {
    this._heap = heap;
    this._edge = new Edge(edgeStart, heap);
    this._edgeEnd = edgeEnd;
  }

  public hasNext(): boolean {
    return this._edge.edgeIndex < this._edgeEnd;
  }

  public next(): void {
    this._edge.edgeIndex++;
  }

  public item(): Edge {
    return this._edge;
  }
}

/**
 * Node mirror.
 */
class Node {
  public nodeIndex: NodeIndex
  private _heap: HeapGraph;

  constructor(i: NodeIndex, heap: HeapGraph) {
    this.nodeIndex = i;
    this._heap = heap;
  }

  public get type(): SnapshotNodeType {
    return this._heap.nodeTypes[this.nodeIndex];
  }

  public get size(): number {
    return this._heap.nodeSizes[this.nodeIndex];
  }

  public get hasChildren(): boolean {
    return this.childrenLength !== 0;
  }

  public get name(): string {
    return this._heap.stringMap.fromId(this._heap.nodeNames[this.nodeIndex]);
  }

  public get childrenLength(): number {
    const fei = this._heap.firstEdgeIndexes;
    return fei[this.nodeIndex + 1] - fei[this.nodeIndex];
  }

  public get children(): EdgeIterator {
    const fei = this._heap.firstEdgeIndexes;
    return new EdgeIterator(this._heap, fei[this.nodeIndex], fei[this.nodeIndex + 1]);
  }

  public getChild(i: number): Edge {
    const fei = this._heap.firstEdgeIndexes;
    const index = fei[this.nodeIndex] + i as EdgeIndex;
    if (index >= fei[this.nodeIndex + 1]) {
      throw new Error(`Invalid child.`);
    }
    return new Edge(index, this._heap);
  }

  /**
   * Measures the number of properties on the node.
   * May require traversing hidden children.
   * This is the growth metric we use.
   */
  public numProperties(): number {
    let count = 0;
    if (this.hasChildren) {
      for (const it = this.children; it.hasNext(); it.next()) {
        const child = it.item();
        switch(child.snapshotType) {
          case SnapshotEdgeType.Internal:
            switch(child.indexOrName) {
              case "elements": {
                // Contains numerical properties, including those of
                // arrays and objects.
                const elements = child.to;
                // Only count if no children.
                if (!elements.hasChildren) {
                  count += Math.floor(elements.size / 8);
                }
                break;
              }
              case "table": {
                // Contains Map and Set object entries.
                const table = child.to;
                if (table.hasChildren) {
                  count += table.childrenLength;
                }
                break;
              }
              case "properties": {
                // Contains expando properties on DOM nodes,
                // properties storing numbers on objects,
                // etc.
                const props = child.to;
                if (props.hasChildren) {
                  count += props.childrenLength;
                }
                break;
              }
            }
            break;
          case SnapshotEdgeType.Hidden:
          case SnapshotEdgeType.Shortcut:
          case SnapshotEdgeType.Weak:
            break;
          default:
            count++;
            break;
        }
      }
    }
    return count;
  }
}

/**
 * Represents a heap snapshot / heap graph.
 */
export class HeapGraph {
  public static async Construct(parser: HeapSnapshotParser, stringMap: StringMap = new StringMap()): Promise<HeapGraph> {
    const firstChunk = await parser.read();
    if (firstChunk.type !== DataTypes.SNAPSHOT) {
      throw new Error(`First chunk does not contain snapshot property.`);
    }
    const snapshotInfo = firstChunk.data;
    const meta = snapshotInfo.meta;
    const nodeFields = meta.node_fields;
    const nodeLength = nodeFields.length;
    const rootNodeIndex = (snapshotInfo.root_index ? snapshotInfo.root_index / nodeLength : 0) as NodeIndex;
    const nodeCount = snapshotInfo.node_count;
    const edgeCount = snapshotInfo.edge_count;
    const nodeTypes = new Uint8Array(nodeCount);
    const nodeNames = new Uint32Array(nodeCount);
    const nodeSizes = new Uint32Array(nodeCount);
    const firstEdgeIndexes = new Uint32Array(nodeCount + 1);
    const edgeTypes = new Uint8Array(edgeCount);
    const edgeNamesOrIndexes = new Uint32Array(edgeCount);
    const edgeToNodes = new Uint32Array(edgeCount);

    {
      const nodeTypeOffset = nodeFields.indexOf("type");
      const nodeNameOffset = nodeFields.indexOf("name");
      const nodeSelfSizeOffset = nodeFields.indexOf("self_size");
      const nodeEdgeCountOffset = nodeFields.indexOf("edge_count");
      const edgeFields = meta.edge_fields;
      const edgeLength = edgeFields.length;
      const edgeTypeOffset = edgeFields.indexOf("type");
      const edgeNameOrIndexOffset = edgeFields.indexOf("name_or_index");
      const edgeToNodeOffset = edgeFields.indexOf("to_node");
      let strings: Array<string> = [];

      let nodePtr = 0;
      let edgePtr = 0;
      let nextEdge = 0;
      while (true) {
        const chunk = await parser.read();
        if (chunk === null) {
          break;
        }
        switch (chunk.type) {
          case DataTypes.NODES: {
            const data = chunk.data;
            const dataLen = data.length;
            const dataNodeCount = dataLen / nodeLength;
            if (dataLen % nodeLength !== 0) {
              throw new Error(`Expected chunk to contain whole nodes. Instead, contained ${dataNodeCount} nodes.`);
            }
            // Copy data into our typed arrays.
            for (let i = 0; i < dataNodeCount; i++) {
              const dataBase = i * nodeLength;
              const arrayBase = nodePtr + i;
              nodeTypes[arrayBase] = data[dataBase + nodeTypeOffset];
              nodeNames[arrayBase] = data[dataBase + nodeNameOffset];
              nodeSizes[arrayBase] = data[dataBase + nodeSelfSizeOffset];
              firstEdgeIndexes[arrayBase] = nextEdge;
              nextEdge += data[dataBase + nodeEdgeCountOffset];
            }
            nodePtr += dataNodeCount;
            break;
          }
          case DataTypes.EDGES: {
            const data = chunk.data;
            const dataLen = data.length;
            const dataEdgeCount = dataLen / edgeLength;
            if (dataLen % edgeLength !== 0) {
              throw new Error(`Expected chunk to contain whole nodes. Instead, contained ${dataEdgeCount} nodes.`);
            }
            // Copy data into our typed arrays.
            for (let i = 0; i < dataEdgeCount; i++) {
              const dataBase = i * edgeLength;
              const arrayBase = edgePtr + i;
              edgeTypes[arrayBase] = data[dataBase + edgeTypeOffset];
              edgeNamesOrIndexes[arrayBase] = data[dataBase + edgeNameOrIndexOffset];
              edgeToNodes[arrayBase] = data[dataBase + edgeToNodeOffset] / nodeLength;
            }
            edgePtr += dataEdgeCount;
            break;
          }
          case DataTypes.STRINGS: {
            strings = strings.concat(chunk.data);
            break;
          }
          default:
            throw new Error(`Unexpected snapshot chunk: ${chunk.type}.`);
        }
      }
      // Process edgeNameOrIndex now.
      for (let i = 0; i < edgeCount; i++) {
        const edgeType = edgeTypes[i];
        switch(edgeType) {
          case SnapshotEdgeType.Element: // Array element.
          case SnapshotEdgeType.Hidden: // Hidden from developer, but influences in-memory size. Apparently has an index, not a name. Ignore for now.
            break;
          case SnapshotEdgeType.ContextVariable: // Function context. I think it has a name, like "context".
          case SnapshotEdgeType.Internal: // Internal data structures that are not actionable to developers. Influence retained size. Ignore for now.
          case SnapshotEdgeType.Shortcut: // Shortcut: Should be ignored; an internal detail.
          case SnapshotEdgeType.Weak: // Weak reference: Doesn't hold onto memory.
          case SnapshotEdgeType.Property: // Property on an object.
            edgeNamesOrIndexes[i] = stringMap.get(strings[edgeNamesOrIndexes[i]]);
            break;
          default:
            throw new Error(`Unrecognized edge type: ${edgeType}`);
        }
      }
      firstEdgeIndexes[nodeCount] = edgeCount;
      // Process nodeNames now.
      for (let i = 0; i < nodeCount; i++) {
        nodeNames[i] = stringMap.get(strings[nodeNames[i]]);
      }
    }
    return new HeapGraph(stringMap, nodeTypes, nodeNames, nodeSizes,
      firstEdgeIndexes, edgeTypes, edgeNamesOrIndexes, edgeToNodes, rootNodeIndex);
  }

  public readonly stringMap: StringMap;
  // Map from node index => node type
  public readonly nodeTypes: Uint8Array;
  // Map from node index => node name.
  public readonly nodeNames: Uint32Array;
  // Map from node index => node size.
  public readonly nodeSizes: Uint32Array;
  // Map from Node index => the index of its first edge / the last index of ID - 1
  public readonly firstEdgeIndexes: {[n: number]: EdgeIndex} & Uint32Array;
  // Map from edge index => edge type.
  public readonly edgeTypes: Uint8Array;
  // Map from edge index => edge name.
  public readonly edgeNamesOrIndexes: Uint32Array;
  // Map from edge index => destination node.
  public readonly edgeToNodes: {[n: number]: NodeIndex} & Uint32Array; // Uint32Array
  // Index of the graph's root node.
  public readonly rootNodeIndex: NodeIndex;
  // Lazily initialized retained size array.
  public readonly retainedSize: Uint32Array = null;

  private constructor(stringMap: StringMap, nodeTypes: Uint8Array, nodeNames: Uint32Array,
    nodeSizes: Uint32Array, firstEdgeIndexes: Uint32Array, edgeTypes: Uint8Array,
    edgeNamesOrIndexes: Uint32Array, edgeToNodes: Uint32Array, rootNodeIndex: NodeIndex) {
      this.stringMap = stringMap;
      this.nodeTypes = nodeTypes;
      this.nodeNames = nodeNames;
      this.nodeSizes = nodeSizes;
      this.firstEdgeIndexes = firstEdgeIndexes as any;
      this.edgeTypes = edgeTypes;
      this.edgeNamesOrIndexes = edgeNamesOrIndexes;
      this.edgeToNodes = edgeToNodes as any;
      this.rootNodeIndex = rootNodeIndex;
  }

  public get nodeCount(): number {
    return this.nodeTypes.length;
  }

  public get edgeCount(): number {
    return this.edgeTypes.length;
  }

  public getGlobalRootIndices(): number[] {
    const rv = new Array<number>();
    const root = this.getRoot();
    for (const it = root.children; it.hasNext(); it.next()) {
      const subroot = it.item().to;
      if (subroot.type !== SnapshotNodeType.Synthetic) {
        rv.push(subroot.nodeIndex);
      }
    }
    return rv;
  }

  public getUserRootIndices(): number[] {
    const rv = new Array<number>();
    const root = this.getRoot();
    for (const it = root.children; it.hasNext(); it.next()) {
      const subroot = it.item().to;
      if (subroot.type !== SnapshotNodeType.Synthetic || subroot.name === "(Document DOM trees)") {
        rv.push(subroot.nodeIndex);
      }
    }
    return rv;
  }

  public getRoot(): Node {
    return new Node(this.rootNodeIndex, this);
  }

  public calculateSize(): SnapshotSizeSummary {
    const rv: SnapshotSizeSummary = {
      numNodes: this.nodeCount,
      numEdges: this.edgeCount,
      totalSize: 0,
      hiddenSize: 0,
      arraySize: 0,
      stringSize: 0,
      objectSize: 0,
      codeSize: 0,
      closureSize: 0,
      regexpSize: 0,
      heapNumberSize: 0,
      nativeSize: 0,
      syntheticSize: 0,
      consStringSize: 0,
      slicedStringSize: 0,
      symbolSize: 0,
      unknownSize: 0
    };
    this.visitUserRoots((n) => {
      const nodeType = n.type;
      const nodeSelfSize = n.size;
      rv.totalSize += n.size;
      switch (nodeType) {
        case SnapshotNodeType.Array:
          rv.arraySize += nodeSelfSize;
          break;
        case SnapshotNodeType.Closure:
          rv.closureSize += nodeSelfSize;
          break;
        case SnapshotNodeType.Code:
          rv.codeSize += nodeSelfSize;
          break;
        case SnapshotNodeType.ConsString:
          rv.consStringSize += nodeSelfSize;
          break;
        case SnapshotNodeType.HeapNumber:
          rv.heapNumberSize += nodeSelfSize;
          break;
        case SnapshotNodeType.Hidden:
          rv.hiddenSize += nodeSelfSize;
          break;
        case SnapshotNodeType.Native:
          rv.nativeSize += nodeSelfSize;
          break;
        case SnapshotNodeType.Object:
          rv.objectSize += nodeSelfSize;
          break;
        case SnapshotNodeType.RegExp:
          rv.regexpSize += nodeSelfSize;
          break;
        case SnapshotNodeType.SlicedString:
          rv.slicedStringSize += nodeSelfSize;
          break;
        case SnapshotNodeType.String:
          rv.stringSize += nodeSelfSize;
          break;
        case SnapshotNodeType.Symbol:
          rv.symbolSize += nodeSelfSize;
          break;
        case SnapshotNodeType.Synthetic:
          rv.syntheticSize += nodeSelfSize;
          break;
        case SnapshotNodeType.Unresolved:
        default:
          rv.unknownSize += nodeSelfSize;
          break;
      }
    });
    return rv;
  }

  public visitRoot(visitor: (n: Node) => void, filter: (n: Node, e: Edge) => boolean = nonWeakFilter): void {
    bfsVisitor(this, [this.rootNodeIndex], visitor, filter);
  }

  public visitUserRoots(visitor: (n: Node) => void, filter: (n: Node, e: Edge) => boolean = nonWeakFilter) {
    bfsVisitor(this, this.getUserRootIndices(), visitor, filter);
  }

  public visitGlobalRoots(visitor: (n: Node) => void, filter: (n: Node, e: Edge) => boolean = nonWeakFilter) {
    bfsVisitor(this, this.getGlobalRootIndices(), visitor, filter);
  }

  public visitGlobalEdges(visitor: (e: Edge, getPath: () => Edge[]) => void, filter: (n: Node, e: Edge) => boolean = nonWeakFilter): void {
    let initial = new Array<number>();
    const root = this.getRoot();
    for (const it = root.children; it.hasNext(); it.next()) {
      const edge = it.item();
      const subroot = edge.to;
      if (subroot.type !== SnapshotNodeType.Synthetic) {
        initial.push(edge.edgeIndex);
      }
    }
    bfsEdgeVisitor(this, initial, visitor, filter);
  }
}

function nonWeakFilter(n: Node, e: Edge): boolean {
  return e.snapshotType !== SnapshotEdgeType.Weak;
}

function nopFilter(n: Node, e: Edge): boolean {
  return true;
}

/**
 * Visit edges / paths in the graph in a breadth-first-search.
 * @param g The heap graph to visit.
 * @param initial Initial edge indices to visit.
 * @param visitor Visitor function. Called on every unique edge visited.
 * @param filter Filter function. Called on every edge. If false, visitor does not visit edge.
 */
function bfsEdgeVisitor(g: HeapGraph, initial: number[], visitor: (e: Edge, getPath: () => Edge[]) => void, filter: (n: Node, e: Edge) => boolean = nopFilter): void {
  const visitBits = new OneBitArray(g.edgeCount);
  // Every edge is a pair: [previousEdge, edgeIndex].
  // Can follow linked list to reconstruct path.
  // Index 0 is "root".
  const edgesToVisit = new Uint32Array((g.edgeCount + 1) << 1);
  // Leave first entry blank as a catch-all root.
  let edgesToVisitLength = 2;
  let index = 2;

  function enqueue(prevIndex: number, edgeIndex: number): void {
    edgesToVisit[edgesToVisitLength++] = prevIndex;
    edgesToVisit[edgesToVisitLength++] = edgeIndex;
  }

  function dequeue(): EdgeIndex {
    // Ignore the prev edge link.
    index++;
    return edgesToVisit[index++] as EdgeIndex;
  }

  initial.forEach((i) => {
    enqueue(0, i);
    visitBits.set(i, true);
  });

  function indexToEdge(index: number): Edge {
    return new Edge(index as EdgeIndex, g);
  }

  let currentEntryIndex = index;
  function getPath(): Edge[] {
    let pIndex = currentEntryIndex;
    let path = new Array<number>();
    while (pIndex !== 0) {
      path.push(edgesToVisit[pIndex + 1]);
      pIndex = edgesToVisit[pIndex];
    }
    return path.reverse().map(indexToEdge);
  }

  const node = new Node(0 as NodeIndex, g);
  const edge = new Edge(0 as EdgeIndex, g);
  while (index < edgesToVisitLength) {
    currentEntryIndex = index;
    edge.edgeIndex = dequeue();
    visitor(edge, getPath);
    node.nodeIndex = edge.toIndex;
    for (const it = node.children; it.hasNext(); it.next()) {
      const child = it.item();
      if (!visitBits.get(child.edgeIndex) && filter(node, child)) {
        visitBits.set(child.edgeIndex, true);
        enqueue(currentEntryIndex, child.edgeIndex);
      }
    }
  }
}

/**
 * Visit the graph in a breadth-first-search.
 * @param g The heap graph to visit.
 * @param initial Initial node(s) to visit.
 * @param visitor Visitor function. Called on every unique node visited.
 * @param filter Filter function. Called on every edge. If false, visitor does not visit edge.
 */
function bfsVisitor(g: HeapGraph, initial: number[], visitor: (n: Node) => void, filter: (n: Node, e: Edge) => boolean = nopFilter): void {
  const visitBits = new OneBitArray(g.nodeCount);
  const nodesToVisit: {[n: number]: NodeIndex} & Uint32Array = <any> new Uint32Array(g.nodeCount);
  let nodesToVisitLength = 0;
  function enqueue(nodeIndex: NodeIndex): void {
    nodesToVisit[nodesToVisitLength++] = nodeIndex;
  }

  let index = 0;
  initial.map(enqueue);
  initial.forEach((i) => visitBits.set(i, true));

  const node = new Node(0 as NodeIndex, g);
  const edge = new Edge(0 as EdgeIndex, g);
  while (index < nodesToVisitLength) {
    const nodeIndex = nodesToVisit[index++];
    node.nodeIndex = nodeIndex;
    visitor(node);
    const firstEdgeIndex = g.firstEdgeIndexes[nodeIndex];
    const edgesEnd = g.firstEdgeIndexes[nodeIndex + 1];
    for (let edgeIndex = firstEdgeIndex; edgeIndex < edgesEnd; edgeIndex++) {
      const childNodeIndex = g.edgeToNodes[edgeIndex];
      edge.edgeIndex = edgeIndex;
      if (!visitBits.get(childNodeIndex) && filter(node, edge)) {
        visitBits.set(childNodeIndex, true);
        enqueue(childNodeIndex);
      }
    }
  }
}
