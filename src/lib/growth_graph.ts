import {HeapSnapshot, SnapshotEdgeType, SnapshotNodeType, SnapshotSizeSummary} from '../common/interfaces';
import {OneBitArray, TwoBitArray} from '../common/util';

function isHidden(type: SnapshotEdgeType): boolean {
  switch(type) {
    case SnapshotEdgeType.Internal:
    case SnapshotEdgeType.Hidden:
    case SnapshotEdgeType.Shortcut:
      return true;
    default:
      return false;
  }
}

type EdgeIndex = number & { ___EdgeIndex: true };
type NodeIndex = number & { ___NodeIndex: true };

export function ToSerializeableGCPath(path: Edge[]): SerializeableGCPath {
  const rv: SerializeableGCPath = {
    root: null,
    path: null
  };
  const firstLink = path[0];
  if (firstLink.to.name.startsWith("Window ")) {
    rv.root = {
      type: RootType.GLOBAL
    };
  } else {
    // DOM object. Skip:
    // - DOM tree collection
    // - index
    if (path.length < 3) {
      console.log("WTF:");
      path.forEach((p, i) => {
        console.log(`[${i}] ${p.to.name}`);
        console.log(`[${i}] ${p.indexOrName}`);
      });
      rv.root = {
        type: RootType.DOM,
        elementType: "HTMLBodyElement"
      };
    } else {
      rv.root = {
        type: RootType.DOM,
        elementType: path[2].to.name
      };
    }
    path = path.slice(3);
  }
  rv.path = path.filter((l) => {
    if (l.type === EdgeType.CLOSURE) {
      return true;
    } else {
      return !isHidden(l.snapshotType);
    }
  });
  return rv;
}

export function ToSerializeableGrowthObject(o: GrowthObject): SerializeableGrowthObject {
  return {
    id: o.node.nodeIndex,
    paths: o.paths.map(ToSerializeableGCPath)
  };
}

/**
 * Indicates a node's growth status.
 * **MUST FIT INTO 2 BITS.** (Value <= 3)
 */
const enum GrowthStatus {
  NEW = 0,
  NOT_GROWING = 1,
  GROWING = 2
}

export interface GrowthObject {
  node: Node;
  paths: Edge[][];
  retainedSize: number;
  adjustedRetainedSize: number;
}

function shouldTraverse(edge: Edge): boolean {
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
        return edge.to.name.startsWith("Document DOM");
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

function mergeGraphs(oldG: HeapGraph, oldGrowth: TwoBitArray, newG: HeapGraph, newGrowth: TwoBitArray): void {
  const numOldNodes = oldG.nodeCount;
  const numNewNodes = newG.nodeCount;
  let index = 0;
  let queue = new Uint32Array(Math.max(numOldNodes, numNewNodes) << 1);
  let queueLength = 0;
  // Only store visit bits for the new graph.
  const visitBits = new OneBitArray(numNewNodes);

  function enqueue(oldNodeIndex: NodeIndex, newNodeIndex: NodeIndex): void {
    queue[queueLength++] = oldNodeIndex;
    queue[queueLength++] = newNodeIndex;
  }

  function dequeue(): NodeIndex {
    return queue[index++] as NodeIndex;
  }

  const oldNode = new Node(0 as NodeIndex, oldG);
  const newNode = new Node(0 as NodeIndex, newG);
  const oldEdgeTmp = new Edge(0 as EdgeIndex, oldG);

  enqueue(oldG.rootNodeIndex, newG.rootNodeIndex);
  visitBits.set(newG.rootNodeIndex, true);
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
            shouldTraverse(oldEdgeTmp) && shouldTraverse(newChildEdge)) {
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
  public _leakRefs: Uint16Array = null;
  public _nonLeakVisits: OneBitArray = null;

  public addSnapshot(snapshot: HeapSnapshot): void {
    const heap = HeapGraph.Construct(snapshot, this._stringMap);
    const growthStatus = new TwoBitArray(heap.nodeCount);
    if (this._heap !== null) {
      // Initialize all new nodes to 'NOT_GROWING'.
      // We only want to consider stable heap paths present from the first snapshot.
      growthStatus.fill(GrowthStatus.NOT_GROWING);
      // Merge graphs.
      mergeGraphs(this._heap, this._growthStatus, heap, growthStatus);
    }
    // Keep new graph.
    this._heap = heap;
    this._growthStatus = growthStatus;
  }

  public getGraph(): HeapGraph {
    return this._heap;
  }

  public getGrowingPaths(): GrowthObject[] {
    const growthPaths = new Map<NodeIndex, Edge[][]>();
    function addPath(e: Edge[]): void {
      const to = e[e.length - 1].toIndex;
      let paths = growthPaths.get(to);
      if (paths === undefined) {
        paths = [];
        growthPaths.set(to, paths);
      }
      paths.push(e);
    }

    function filter(n: Node, e: Edge) {
      return nonWeakFilter(n, e) && shouldTraverse(e);
    }

    // Get the growing paths.
    this._heap.visitUserEdges((e, getPath) => {
      if (this._growthStatus.get(e.toIndex) === GrowthStatus.GROWING) {
        addPath(getPath());
      }
    }, filter);

    // Calculate growth metrics.

    // Mark items that are reachable by non-leaks.
    const nonleakVisitBits = new OneBitArray(this._heap.nodeCount);
    this._heap.visitUserRoots((n) => {
      nonleakVisitBits.set(n.nodeIndex, true);
    }, (n, e) => {
      // Filter out edges to growing objects.
      return filter(n, e) && !growthPaths.has(e.toIndex);
    });

    function nonLeakFilter(n: Node, e: Edge): boolean {
      // Filter out items that are reachable from non-leaks.
      return filter(n, e) && !nonleakVisitBits.get(e.toIndex);
    }

    // Increment visit counter for each heap item reachable from a leak.
    const leakReferences = new Uint16Array(this._heap.nodeCount);
    growthPaths.forEach((paths, growthNodeIndex) => {
      bfsVisitor(this._heap, [growthNodeIndex], (n) => {
        leakReferences[n.nodeIndex]++;
      }, nonLeakFilter);
    });

    // Calculate final growth metrics.
    let rv = new Array<GrowthObject>();
    growthPaths.forEach((paths, growthNodeIndex) => {
      let retainedSize = 0;
      let adjustedRetainedSize = 0;
      bfsVisitor(this._heap, [growthNodeIndex], (n) => {
        const refCount = leakReferences[n.nodeIndex];
        if (refCount === 1) {
          retainedSize += n.size;
        }
        adjustedRetainedSize += n.size / refCount;
      }, nonLeakFilter);
      rv.push({ node: new Node(growthNodeIndex, this._heap), paths, retainedSize, adjustedRetainedSize });
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
  public get indexOrName(): string | number {
    const type = this.type;
    const nameOrIndex = this._heap.edgeNamesOrIndexes[this.edgeIndex];
    switch (type) {
      case EdgeType.INDEX:
        return nameOrIndex;
      case EdgeType.CLOSURE:
      case EdgeType.NAMED:
        return this._heap.stringMap.fromId(nameOrIndex);
    }
  }
  public get type(): EdgeType {
    switch(this.snapshotType) {
      case SnapshotEdgeType.Element: // Array element.
      case SnapshotEdgeType.Hidden: // Hidden from developer, but influences in-memory size. Apparently has an index, not a name. Ignore for now.
        return EdgeType.INDEX;
      case SnapshotEdgeType.ContextVariable: // Function context. I think it has a name, like "context".
        return EdgeType.CLOSURE;
      case SnapshotEdgeType.Internal: // Internal data structures that are not actionable to developers. Influence retained size. Ignore for now.
      case SnapshotEdgeType.Shortcut: // Shortcut: Should be ignored; an internal detail.
      case SnapshotEdgeType.Weak: // Weak reference: Doesn't hold onto memory.
      case SnapshotEdgeType.Property: // Property on an object.
        return EdgeType.NAMED;
      default:
        throw new Error(`Unrecognized edge type: ${this.snapshotType}`);
    }
  }
  public toJSON(): SerializeableEdge {
    return {
      type: this.type,
      indexOrName: this.indexOrName
    };
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
 * Node class that forms the heap graph.
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
  public static Construct(snapshot: HeapSnapshot, stringMap: StringMap = new StringMap()): HeapGraph {
    const snapshotInfo = snapshot.snapshot;
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
      const strings = snapshot.strings;
      const nodes = snapshot.nodes;
      const nodeTypeOffset = nodeFields.indexOf("type");
      const nodeNameOffset = nodeFields.indexOf("name");
      const nodeSelfSizeOffset = nodeFields.indexOf("self_size");
      const nodeEdgeCountOffset = nodeFields.indexOf("edge_count");
      const edges = snapshot.edges;
      const edgeFields = meta.edge_fields;
      const edgeLength = edgeFields.length;
      const numEdges = edges.length / edgeLength;
      const edgeTypeOffset = edgeFields.indexOf("type");
      const edgeNameOrIndexOffset = edgeFields.indexOf("name_or_index");
      const edgeToNodeOffset = edgeFields.indexOf("to_node");

      // Parse the snapshot into a graph.
      let nextEdge = 0;
      for (let i = 0; i < nodeCount; i++) {
        const base = i * nodeLength;
        const nodeName = nodes[base + nodeNameOffset];
        const nodeEdgeCount = nodes[base + nodeEdgeCountOffset];

        nodeNames[i] = stringMap.get(strings[nodeName]);
        nodeSizes[i] = nodes[base + nodeSelfSizeOffset];
        nodeTypes[i] = nodes[base + nodeTypeOffset];
        firstEdgeIndexes[i] = nextEdge;

        const lastEdgeIndex = nextEdge + nodeEdgeCount;

        for (let j = nextEdge; j < lastEdgeIndex; j++) {
          const base = j * edgeLength;
          let edgeNameOrIndex = edges[base + edgeNameOrIndexOffset];
          const edgeType = edges[base + edgeTypeOffset];
          switch(edgeType) {
            case SnapshotEdgeType.Element: // Array element.
            case SnapshotEdgeType.Hidden: // Hidden from developer, but influences in-memory size. Apparently has an index, not a name. Ignore for now.
              break;
            case SnapshotEdgeType.ContextVariable: // Function context. I think it has a name, like "context".
            case SnapshotEdgeType.Internal: // Internal data structures that are not actionable to developers. Influence retained size. Ignore for now.
            case SnapshotEdgeType.Shortcut: // Shortcut: Should be ignored; an internal detail.
            case SnapshotEdgeType.Weak: // Weak reference: Doesn't hold onto memory.
            case SnapshotEdgeType.Property: // Property on an object.
              edgeNameOrIndex = stringMap.get(strings[edgeNameOrIndex]);
              break;
            default:
              throw new Error(`Unrecognized edge type: ${edgeType}`);
          }
          edgeTypes[j] = edgeType;
          edgeNamesOrIndexes[j] = edgeNameOrIndex;
          edgeToNodes[j] = edges[base + edgeToNodeOffset] / nodeLength;
        }
        nextEdge = lastEdgeIndex;

        if (lastEdgeIndex > numEdges) {
          throw new Error(`Read past the edge array: ${lastEdgeIndex} > ${numEdges}`);
        }
      }
      firstEdgeIndexes[nodeCount] = numEdges;
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

  public visitUserEdges(visitor: (e: Edge, getPath: () => Edge[]) => void, filter: (n: Node, e: Edge) => boolean = nonWeakFilter): void {
    let initial = new Array<number>();
    const root = this.getRoot();
    for (const it = root.children; it.hasNext(); it.next()) {
      const edge = it.item();
      const subroot = edge.to;
      if (subroot.type !== SnapshotNodeType.Synthetic || subroot.name === "(Document DOM trees)") {
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

  let currentEntryIndex = index;
  function getPath(): Edge[] {
    let pIndex = currentEntryIndex;
    let path = new Array<number>();
    while (pIndex !== 0) {
      path.push(edgesToVisit[pIndex + 1]);
      pIndex = edgesToVisit[pIndex];
    }
    return path.reverse().map((index) => new Edge(index as EdgeIndex, g));
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
