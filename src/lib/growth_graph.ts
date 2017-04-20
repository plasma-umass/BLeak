import {SnapshotEdgeType, SnapshotNodeType, ClosurePath} from '../common/interfaces';

export const enum NodeFlag {
  VisitBit = 1 << 31,
  Growing = 1 << 30,
  New = 1 << 29,
  // Maximum value of data in the 32-bit field.
  DataMask = ~(NodeFlag.VisitBit | NodeFlag.Growing | NodeFlag.New)
}

export type Edge = NamedEdge | IndexEdge | ClosureEdge;

export const enum EdgeType {
  INDEX = 0,
  NAMED = 1,
  CLOSURE = 2
}

/**
 * Named property, e.g. obj['foo']
 */
export class NamedEdge {
  public readonly indexOrName: string;
  public to: Node;
  constructor(name: string, to: Node) {
    this.indexOrName = name;
    this.to = to;
  }
  public get type(): EdgeType.NAMED {
    return EdgeType.NAMED;
  }
}

/**
 * Numerical index property, e.g. obj[1]
 */
export class IndexEdge {
  public readonly indexOrName: number;
  public to: Node;
  constructor(indexOrName: number, to: Node) {
    this.indexOrName = indexOrName;
    this.to = to;
  }
  public get type(): EdgeType.INDEX {
    return EdgeType.INDEX;
  }
}

/**
 * Function closure, e.g.
 * var a; function foo() { return a; }
 * ^ foo's closure contains 'a'.
 */
export class ClosureEdge {
  public readonly indexOrName: string;
  public to: Node;
  constructor(name: string, to: Node) {
    this.indexOrName = name;
    this.to = to;
  }
  public get type(): EdgeType.CLOSURE {
    return EdgeType.CLOSURE;
  }
}

function MakeEdge(edgeType: SnapshotEdgeType, nameOrIndex: number, toNode: Node, lookupString: (id: number) => string): Edge | null {
  switch (edgeType) {
    case SnapshotEdgeType.Element: // Array element.
      return new IndexEdge(nameOrIndex, toNode);
    case SnapshotEdgeType.ContextVariable: // Function context. I think it has a name, like "context".
      return new ClosureEdge(lookupString(nameOrIndex), toNode);
    case SnapshotEdgeType.Property: // Property on an object.
      return new NamedEdge(lookupString(nameOrIndex), toNode);
    // The remaining types cannot be observed at the program-level, and are not actionable to us.
    // Our runtime agent will "lift" some of this state into actionable state.
    case SnapshotEdgeType.Hidden: // Hidden from developer, but influences in-memory size. Apparently has an index, not a name. Ignore for now.
    case SnapshotEdgeType.Internal: // Internal data structures that are not actionable to developers. Influence retained size. Ignore for now.
    case SnapshotEdgeType.Shortcut: // Shortcut: Should be ignored; an internal detail.
    case SnapshotEdgeType.Weak: // Weak reference: Doesn't hold onto memory.
    default: // Who knows?
      return null;
  }
}

/**
 * Node class that forms the heap graph.
 */
export class Node {
  private _flagsAndType = SnapshotNodeType.Unresolved;
  public children: Edge[] = null;

  public set type(type: SnapshotNodeType) {
    this._flagsAndType &= ~(NodeFlag.DataMask);
    this._flagsAndType |= type;
  }
  public get type(): SnapshotNodeType {
    return this._flagsAndType & NodeFlag.DataMask;
  }
  public setFlag(flag: NodeFlag): void {
    this._flagsAndType |= flag;
  }
  public unsetFlag(flag: NodeFlag): void {
    this._flagsAndType &= ~flag;
  }
  public hasFlag(flag: NodeFlag): boolean {
    return !!(this._flagsAndType & flag);
  }
}

/**
 * Given a heap snapshot, builds a growth graph.
 */
export class GrowthGraphBuilder {
  private _lookupString: (id: number) => string;
  private _stringPool: Map<string, number>;
  private _currentNode: Node = null;
  private _gcRootString: number;
  private _nodeMap = new Map<number, Node>();
  private _root: Node = null;
  constructor(stringPool: Map<string, number>, lookupString: (id: number) => string) {
    this._lookupString = lookupString;
    this._stringPool = stringPool;
    this._gcRootString = stringPool.get("(GC roots)");
    if (this._gcRootString === undefined) {
      throw new Error(`Failed to find (GC roots) string.`);
    }
  }
  private _getOrMakeNode(id: number) {
    const node = this._nodeMap.get(id);
    if (!node) {
      const node = new Node();
      node.setFlag(NodeFlag.New);
      this._nodeMap.set(id, node);
      return node;
    }
    return node;
  }
  public get root(): Node {
    const root = this._root;
    if (!root) {
      throw new Error(`(GC roots) node not found in snapshot.`);
    }
    return root;
  }
  public visitNode(type: SnapshotNodeType, name: number, id: number, selfSize: number, edgeCount: number): void {
    const nodeObject = this._getOrMakeNode(id);
    if (name === this._gcRootString) {
      if (this._root === null) {
        this._root = nodeObject;
      } else {
        throw new Error(`Multiple GC roots?`);
      }
    }
    nodeObject.type = type;
    this._currentNode = nodeObject;
    if (edgeCount > 0) {
      this._currentNode.children = [];
    }
  }
  public visitEdge(type: SnapshotEdgeType, nameOrIndex: number, toNode: number): void {
    if (!this._currentNode) {
      throw new Error(`Invariant failure: Edge visited before node.`);
    }
    const edge = MakeEdge(type, nameOrIndex, this._getOrMakeNode(toNode), this._lookupString);
    if (edge) {
      this._currentNode.children.push(edge);
    }
  }
}

/**
 * DFS exploration of graph. Checks if nodes in the graph have grown.
 * @param prev Node from the previous snapshot at current heap path.
 * @param current Node from the current snapshot at current heap path.
 */
export function MergeGraphs(prev: Node, current: Node): void {
  const visitBit = current.hasFlag(NodeFlag.VisitBit);
  if (visitBit) {
    // Ignore visited nodes.
    return;
  } else {
    current.setFlag(NodeFlag.VisitBit);
  }
  // `current` has an analogue in the previous snapshot, so it is no longer 'new'.
  current.unsetFlag(NodeFlag.New);

  // Nodes are either 'New', 'Growing', or 'Not Growing'.
  // Nodes begin as 'New', and transition to 'Growing' or 'Not Growing' after a snapshot.
  // So if a node is neither new nor consistently growing, we don't care about it.
  if ((prev.hasFlag(NodeFlag.New) || prev.hasFlag(NodeFlag.Growing)) && prev.children.length < current.children.length) {
    current.setFlag(NodeFlag.Growing);
  }

  // Visit shared children. New children are ignored, and remain in the 'new' state.
  const prevEdges = new Map<string | number, Edge>();
  for (const edge of prev.children) {
    prevEdges.set(edge.indexOrName, edge);
  }

  for (const edge of current.children) {
    const prevEdge = prevEdges.get(edge.indexOrName);
    if (prevEdge) {
      MergeGraphs(prevEdge.to, edge.to);
    }
  }
}

/**
 * Performs a BFS to find the shortest path to growing objects.
 * @param root The root of the heap.
 */
export function FindGrowthPaths(root: Node): GrowthPath[] {
  let found = new Set<Node>();
  // Paths in shallow -> deep order.
  let growingPaths: GrowthPath[] = []
  let frontier: GrowthPath[] = root.children.map((e) => new GrowthPath([e]));
  let nextFrontier: GrowthPath[] = [];

  while (frontier.length > 0) {
    const path = frontier.shift();
    if (frontier.length === 0) {
      const temp = frontier;
      // Swap buffers; go one deeper.
      frontier = nextFrontier;
      nextFrontier = temp;
    }
    const node = path.end();
    if (!found.has(node)) {
      found.add(node);
      if (node.hasFlag(NodeFlag.Growing)) {
        growingPaths.push(path);
      }
      const children = node.children;
      for (const child of children) {
        nextFrontier.push(path.addEdge(child));
      }
    }
  }

  return growingPaths;
}

const r = /'/g;
/**
 * Escapes single quotes in the given string.
 * @param s
 */
function safeString(s: string): string {
  return s.replace(r, "\'");
}

/**
 * A path from GC root to a growing heap object.
 */
export class GrowthPath {
  private _path: Edge[];
  private _accessString: string = null;

  constructor(path: Edge[]) {
    this._path = path;
  }

  public addEdge(e: Edge): GrowthPath {
    return new GrowthPath(this._path.concat(e));
  }

  public end(): Node {
    const len = this._path.length;
    if (len > 0) {
      return this._path[len - 1].to;
    }
    return null;
  }

  /**
   * Retrieves all closure paths that need to be instrumented.
   */
  public getClosurePaths(): ClosurePath[] {
    let rv: ClosurePath[] = [];
    let accessString = "";
    for (const link of this._path) {
      switch (link.type) {
        case EdgeType.CLOSURE:
          rv.push({
            path: accessString,
            variables: [link.indexOrName],
            sources: new Set<string>()
          });
          accessString += `.__closure__['${safeString(link.indexOrName)}']`;
          break;
        case EdgeType.INDEX:
          accessString += `[${link.indexOrName}]`;
          break;
        case EdgeType.NAMED:
          accessString += `['${safeString(link.indexOrName)}']`;
          break;
      }
    }
    this._accessString = accessString;
    return rv;
  }

  public getAccessString(): string {
    if (!this._accessString) {
      this.getClosurePaths();
    }
    return this._accessString;
  }
}