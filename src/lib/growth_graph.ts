import {SnapshotEdgeType, SnapshotNodeType} from '../common/interfaces';

export const enum NodeFlag {
  VisitBit = 1 << 31,
  Growing = 1 << 30,
  New = 1 << 29,
  TypeMask = 0xF000000,
  // Maximum value of data in the 32-bit field.
  DataMask = 0xFFFFFF,
  SignMask = 0x800000
}

export type Edge = NamedEdge | IndexEdge | ClosureEdge;

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
        return `${edge.indexOrName}`.startsWith("Document");
    }
  }
  return true;
}

function serializeEdge(e: Edge): SerializeableEdge {
  return {
    type: e.type,
    indexOrName: e.indexOrName
  };
}

/**
 * Named property, e.g. obj['foo']
 */
export class NamedEdge {
  public readonly indexOrName: string;
  public to: Node;
  public snapshotType: SnapshotEdgeType;
  constructor(name: string, to: Node, type: SnapshotEdgeType) {
    this.indexOrName = name;
    this.to = to;
    this.snapshotType = type;
  }
  public get type(): EdgeType.NAMED {
    return EdgeType.NAMED;
  }
  public toJSON(): SerializeableEdge {
    return serializeEdge(this);
  }
}

/**
 * Numerical index property, e.g. obj[1]
 */
export class IndexEdge {
  public readonly indexOrName: number;
  public to: Node;
  public snapshotType: SnapshotEdgeType;
  constructor(indexOrName: number, to: Node, type: SnapshotEdgeType) {
    this.indexOrName = indexOrName;
    this.to = to;
    this.snapshotType = type;
  }
  public get type(): EdgeType.INDEX {
    return EdgeType.INDEX;
  }
  public toJSON(): SerializeableEdge {
    return serializeEdge(this);
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
  public snapshotType: SnapshotEdgeType;
  constructor(name: string, to: Node, type: SnapshotEdgeType) {
    this.indexOrName = name;
    this.to = to;
    this.snapshotType = type;
  }
  public get type(): EdgeType.CLOSURE {
    return EdgeType.CLOSURE;
  }
  public toJSON(): SerializeableEdge {
    return serializeEdge(this);
  }
}

function MakeEdge(edgeType: SnapshotEdgeType, nameOrIndex: number, toNode: Node, lookupString: (id: number) => string): Edge | null {
  switch (edgeType) {
    case SnapshotEdgeType.Element: // Array element.
    case SnapshotEdgeType.Hidden: // Hidden from developer, but influences in-memory size. Apparently has an index, not a name. Ignore for now.
      return new IndexEdge(nameOrIndex, toNode, edgeType);
    case SnapshotEdgeType.ContextVariable: // Function context. I think it has a name, like "context".
      return new ClosureEdge(lookupString(nameOrIndex), toNode, edgeType);
    case SnapshotEdgeType.Internal: // Internal data structures that are not actionable to developers. Influence retained size. Ignore for now.
    case SnapshotEdgeType.Shortcut: // Shortcut: Should be ignored; an internal detail.
    case SnapshotEdgeType.Weak: // Weak reference: Doesn't hold onto memory.
    case SnapshotEdgeType.Property: // Property on an object.
      return new NamedEdge(lookupString(nameOrIndex), toNode, edgeType);
    // The remaining types cannot be observed at the program-level, and are not actionable to us.
    // Our runtime agent will "lift" some of this state into actionable state.
    default: // Who knows?
      // console.log(`Unknown edge type ${edgeType}`);
      return null;
  }
}

/**
 * Node class that forms the heap graph.
 */
export class Node {
  private _flagsAndType = SnapshotNodeType.Unresolved | 0;
  public children: Edge[] = null;
  public name: string = "(unknown)";
  public size: number = 0 | 0;

  public set type(type: SnapshotNodeType) {
    // Max value of type is 15.
    const modType = type & 0xF;
    // Reset type.
    this._flagsAndType &= ~(NodeFlag.TypeMask)
    this._flagsAndType |= (modType << 24);
  }
  public get type(): SnapshotNodeType {
    return (this._flagsAndType & NodeFlag.TypeMask) >> 24;
  }

  /**
   * Store signed integer in the flag integer.
   */
  public set dataValue(data: number) {
    // Clear data field.
    this._flagsAndType &= ~(NodeFlag.DataMask);
    // Reset and store mask.
    this._flagsAndType |= (data & NodeFlag.DataMask) | ((data & 0x80000000) >>> 8);
  }

  public get dataValue(): number {
    // Sign extend.
    let sign = 0;
    if ((this._flagsAndType & NodeFlag.SignMask) !== 0) {
      sign = 0xFF000000;
    }
    return sign | (this._flagsAndType & NodeFlag.DataMask);
  }

  public get isNew(): boolean {
    return this._hasFlag(NodeFlag.New);
  }

  public set isNew(v: boolean) {
    this._setFlag(NodeFlag.New, v);
  }

  public get growing(): boolean {
    return this._hasFlag(NodeFlag.Growing);
  }

  public set growing(v: boolean) {
    this._setFlag(NodeFlag.Growing, v);
  }

  public get visited(): boolean {
    return this._hasFlag(NodeFlag.VisitBit);
  }

  public set visited(v: boolean) {
    this._setFlag(NodeFlag.VisitBit, v);
  }

  private _setFlag(flag: NodeFlag, enable: boolean): void {
    if (enable) {
      this._flagsAndType |= flag;
    } else {
      this._flagsAndType &= ~flag;
    }
  }

  private _hasFlag(flag: NodeFlag): boolean {
    return !!(this._flagsAndType & flag);
  }
  /**
   * Measures the number of properties on the node.
   * May require traversing hidden children.
   * This is the growth metric we use.
   */
  public numProperties(): number {
    let count = 0;
    if (this.children) {
      for (const child of this.children) {
        switch(child.snapshotType) {
          case SnapshotEdgeType.Internal:
            switch(child.indexOrName) {
              case "elements": {
                // Contains numerical properties, including those of
                // arrays and objects.
                const elements = child.to;
                // Only count if no children.
                if (!elements.children || elements.children.length === 0) {
                  count += Math.floor(elements.size / 8);
                }
                break;
              }
              case "table": {
                // Contains Map and Set object entries.
                const table = child.to;
                if (table.children) {
                  count += table.children.length;
                }
                break;
              }
              case "properties": {
                // Contains expando properties on DOM nodes,
                // properties storing numbers on objects,
                // etc.
                const props = child.to;
                if (props.children) {
                  count += props.children.length;
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
  public toString(): string {
    let rv: string[] = [];
    if (this.visited) {
      rv.push("[V]");
    }
    if (this.isNew) {
      rv.push("New");
    }
    if (this.growing) {
      rv.push("Growing");
    }
    if (this.children) {
      rv.push(`(${this.children.length})`);
    } else {
      rv.push(`(0)`);
    }
    return rv.join(" ");
  }
}

/**
 * Given a heap snapshot, builds a growth graph.
 */
export class GrowthGraphBuilder {
  private _lookupString: (id: number) => string;
  private _stringPool: Map<string, number>;
  private _currentNode: Node = null;
  private _nodeMap = new Map<number, Node>();
  private _globalRoot: Node = null;
  private _domRoot: Node = null;
  constructor(stringPool: Map<string, number>, lookupString: (id: number) => string) {
    this._lookupString = lookupString;
    this._stringPool = stringPool;
  }
  private _getOrMakeNode(id: number) {
    const node = this._nodeMap.get(id);
    if (!node) {
      const node = new Node();
      node.isNew = true;
      this._nodeMap.set(id, node);
      return node;
    }
    return node;
  }
  public get root(): Node {
    const root = new Node();
    root.name = "root";
    root.type = SnapshotNodeType.Synthetic;
    let edges: Edge[] = [
      new NamedEdge("window", this._globalRoot, SnapshotEdgeType.Hidden)
    ];
    edges = edges.concat(this._domRoot.children.map((c) => new NamedEdge("dom", c.to, SnapshotEdgeType.Hidden)));
    root.children = edges;
    if (root.children.length === 0 || this._globalRoot === null || this._domRoot === null) {
      throw new Error(`No GC roots found in snapshot?`);
    }
    return root;
  }
  public visitNode(type: SnapshotNodeType, name: number, id: number, selfSize: number, edgeCount: number): void {
    const nodeObject = this._getOrMakeNode(id);
    nodeObject.name = this._lookupString(name);
    if (nodeObject.name && (nodeObject.name.startsWith("Window "))) { // && nodeObject.type === SnapshotNodeType.Code) {
      // console.log(`${id} ${nodeObject.name}`);
      if (this._globalRoot) {
        throw new Error(`Multiple window nodes?!?`);
      }
      this._globalRoot = nodeObject;
    //  console.log(`Has ${edgeCount} children!!!`);
    }
    if (type === SnapshotNodeType.Synthetic && nodeObject.name === "(Document DOM trees)") {
      // console.log("Found DOM root with " + edgeCount + " children.");
      if (edgeCount !== 1) {
        throw new Error(`Multiple DOMs: ${edgeCount}`);
      }
      this._domRoot = nodeObject;
    }
    nodeObject.type = type;
    nodeObject.size = selfSize;
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
 * BFS exploration of graph. Checks if nodes in the graph have grown.
 * @param prev Node from the previous snapshot at current heap path.
 * @param current Node from the current snapshot at current heap path.
 */
export function MergeGraphs(prevGraph: Node, currentGraph: Node): void {
  let frontier: Node[] = [];
  let queue: Node[] = [prevGraph, currentGraph];

  while (queue.length > 0) {
    const current = queue.pop();
    const prev = queue.pop();

    if (!current.visited) {
      current.visited = true;
      // `current` has an analogue in the previous snapshot, so it is no longer 'new'.
      current.isNew = false;

      //console.log(`${prev} -> ${current}`);

      // Nodes are either 'New', 'Growing', or 'Not Growing'.
      // Nodes begin as 'New', and transition to 'Growing' or 'Not Growing' after a snapshot.
      // So if a node is neither new nor consistently growing, we don't care about it.
      if ((prev.isNew || prev.growing) && prev.numProperties() < current.numProperties()) {
      //current.children && ((prev.children === null && current.children.length > 0) || (prev.children && prev.children.length < current.children.length))) {
        current.growing = true;
      }

      // Visit shared children. New children are ignored, and remain in the 'new' state.
      const prevEdges = new Map<string | number, Edge>();
      if (prev.children) {
        for (const edge of prev.children) {
          prevEdges.set(edge.indexOrName, edge);
        }
      }

      if (current.children) {
        for (const edge of current.children) {
          const prevEdge = prevEdges.get(edge.indexOrName);
          if (prevEdge && shouldTraverse(prevEdge)) {
            frontier.push(prevEdge.to, edge.to);
          }
        }
      }
    }

    if (queue.length === 0) {
      const temp = queue;
      queue = frontier;
      frontier = temp;
    }
  }
}

/**
 * Performs a BFS to find the shortest path to growing objects.
 * Returns a set of paths to each growing object.
 * @param root The root of the heap.
 */
export function FindGrowingObjects(root: Node): GrowthObject[] {
  let visited = new Set<Edge>();
  let growingPaths = new Map<Node, GrowthPath[]>();
  let frontier: GrowthPath[] = root.children.map((e) => {
    visited.add(e);
    return new GrowthPath([e]);
  });
  let nextFrontier: GrowthPath[] = [];
  while (frontier.length > 0) {
    const path = frontier.shift();
    const node = path.end();
    if (node.growing) {
      if (!growingPaths.has(node)) {
        growingPaths.set(node, []);
      }
      growingPaths.get(node).push(path);
    }
    // node.setFlag(NodeFlag.New);
    const children = node.children;
    if (children) {
      for (const child of children) {
        if (!visited.has(child)) {
          if (shouldTraverse(child)) {
            visited.add(child);
            nextFrontier.push(path.addEdge(child));
          }
        }
      }
    }
    if (frontier.length === 0) {
      const temp = frontier;
      // Swap buffers; go one deeper.
      frontier = nextFrontier;
      nextFrontier = temp;
    }
  }

  // Convert from map into array of arrays.
  // We don't need to track the key anymore.
  const rv: GrowthObject[] = [];
  growingPaths.forEach((paths, node) => rv.push(new GrowthObject(node, paths)));
  return rv;
}

/**
 * Rank the given growing objects by their impact on the heap according to different metrics
 * @param root The root of the graph.
 * @param growthObjs The growing objects.
 * @return The growth paths in growth order, along with their score.
 */
export function RankGrowingObjects(root: Node, growthObjs: GrowthObject[]): Map<GrowthObject, [string, number][]> {
  let growingObjects = new Set<Node>(growthObjs.map((g) => g.node));
  function getEdgeNode(e: Edge): Node {
    return e.to;
  }
  // DFS traverse from root, marking everything as -1 (except stopping at growth paths).
  {
    let stack = [root];
    let visited = new Set<Node>();
    const hasntVisited = (n: Node) => !visited.has(n);
    while (stack.length > 0) {
      const node = stack.pop();
      visited.add(node);
      // Stop at growing objects.
      if (!growingObjects.has(node)) {
        node.dataValue = -1;
        if (node.children) {
          stack.push(...node.children.filter(shouldTraverse).map(getEdgeNode).filter(hasntVisited));
        }
      }
    }
  }

  // DFS traverse from each growth path, ignoring things marked as -1, and incrementing from 0.
  growthObjs.forEach((obj) => {
    let stack = [obj.node];
    let visited = new Set<Node>();
    // -1 nodes have been visited.
    const hasntVisited = (n: Node) => !visited.has(n) && n.dataValue !== -1;
    while (stack.length > 0) {
      const node = stack.pop();
      visited.add(node);
      node.dataValue = node.dataValue + 1;
      if (node.children) {
        stack.push(...node.children.filter(shouldTraverse).map(getEdgeNode).filter(hasntVisited));
      }
    }
  });

  // DFS traverse from each growth path and sum their sizes.
  let rv = new Map<GrowthObject, [string, number][]>();
  growthObjs.forEach((obj) => {
    const data = new Array<[string, number]>();
    rv.set(obj, data);
    let retainedSize = 0;
    let adjustedRetainedSize = 0;
    let stack = [obj.node];
    let visited = new Set<Node>();
    const hasntVisited = (n: Node) => !visited.has(n) && n.dataValue !== -1;
    while (stack.length > 0) {
      const node = stack.pop();
      visited.add(node);
      const refCount = node.dataValue;
      if (node.size < 0) {
        console.log(`WTF`);
      }
      if (refCount === 1) {
        retainedSize += node.size;
      }
      adjustedRetainedSize += node.size / refCount;
      if (node.children) {
        stack.push(...node.children.filter(shouldTraverse).map(getEdgeNode).filter(hasntVisited));
      }
    }
    data.push(["Retained Size", retainedSize]);
    data.push(["Adjusted Retained Size", adjustedRetainedSize]);
  });

  return rv;
}

/**
 * A path from GC root to a growing heap object.
 */
export class GrowthPath {
  private _path: Edge[];

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
   * Retrieves the path to the object in a serializeable format.
   */
  public toJSON(): SerializeableGCPath {
    let rv: SerializeableGCPath = {
      root: null,
      path: null
    };
    let path = this._path;
    const firstLink = path[0];
    if (firstLink.to.name.startsWith("Window ")) {
      rv.root = {
        type: RootType.GLOBAL
      };
    } else {
      // DOM object. Skip:
      // - DOM tree collection
      // - index
      rv.root = {
        type: RootType.DOM,
        elementType: path[1].to.name
      };
      path = path.slice(2);
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
}

export class GrowthObject {
  private _paths: GrowthPath[];
  public readonly node: Node;
  constructor(node: Node, paths: GrowthPath[]) {
    this.node = node;
    this._paths = paths;
  }

  public addPath(p: GrowthPath) {
    this._paths.push(p);
  }
  public get paths(): GrowthPath[] {
    return this._paths;
  }
  public toJSON(): any {
    return this._paths;
  }
  public get key(): string {
    return JSON.stringify(this._paths[0]);
  }
}