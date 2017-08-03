import {GrowthGraphBuilder, MergeGraphs, Node, GrowthObject, FindGrowingObjects, RankGrowingObjects} from './growth_graph';
import {SnapshotEdgeType, SnapshotNodeType, HeapSnapshot, SnapshotSizeSummary} from '../common/interfaces';

/**
 * Computes the size of the given snapshot without creating a Node object.
 * @param snapshot
 */
export function computeGraphSize(snapshot: HeapSnapshot): SnapshotSizeSummary {
  const rv: SnapshotSizeSummary = {
    numNodes: 0,
    numEdges: 0,
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
  const meta = snapshot.snapshot.meta;
  const nodes = snapshot.nodes;
  const nodeFields = meta.node_fields;
  const nodeLength = nodeFields.length;
  const numNodes = nodes.length / nodeLength;
  const nodeSelfSizeOffset = nodeFields.indexOf("self_size");
  const nodeTypeOffset = nodeFields.indexOf("type");
  const edges = snapshot.edges;
  const edgeFields = meta.edge_fields;
  const edgeLength = edgeFields.length;
  const numEdges = edges.length / edgeLength;

  rv.numNodes = numNodes;
  rv.numEdges = numEdges;

  for (let i = 0; i < numNodes; i++) {
    const base = i * nodeFields.length;
    // Node ID is like a pointer, I'm guessing.
    // Ignored for now.
    // const nodeId = nodes[base + nodeIdOffset];
    const nodeSelfSize = nodes[base + nodeSelfSizeOffset];
    const nodeType: SnapshotNodeType = nodes[base + nodeTypeOffset];
    rv.totalSize += nodeSelfSize;
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
  }

  return rv;
}

/**
 * Constructs a graph from the given snapshot.
 * @param snapshot
 */
export function constructGraph(snapshot: HeapSnapshot, stringPool: Map<string, number> = new Map<string, number>(), stringPoolContents: string[] = []): Node {
  const stringLookupTable = computeStringLookupTable(stringPool, stringPoolContents, snapshot.strings);
  function getString(id: number): number {
    const rv = stringLookupTable.get(id);
    if (rv === undefined) {
      throw new Error(`Unable to find string ${id} in string lookup table!`);
    }
    return rv;
  }
  // Not needed; let it get garbage collected.
  // snapshot.strings = null;
  let visitor = new GrowthGraphBuilder(stringPool, (id: number) => {
    return stringPoolContents[getString(id)];
  });
  // Extract boilerplate information from the snapshot, which tells us how to parse
  // the snapshot.
  const meta = snapshot.snapshot.meta;
  const nodes = snapshot.nodes;
  const nodeFields = meta.node_fields;
  const nodeLength = nodeFields.length;
  const numNodes = nodes.length / nodeLength;
  const nodeTypeOffset = nodeFields.indexOf("type");
  const nodeNameOffset = nodeFields.indexOf("name");
  // const nodeIdOffset = nodeFields.indexOf("id");
  const nodeSelfSizeOffset = nodeFields.indexOf("self_size");
  const nodeEdgeCountOffset = nodeFields.indexOf("edge_count");
  const edges = snapshot.edges;
  const edgeFields = meta.edge_fields;
  const edgeLength = edgeFields.length;
  const numEdges = edges.length / edgeLength;
  const edgeTypeOffset = edgeFields.indexOf("type");
  const edgeNameOrIndexOffset = edgeFields.indexOf("name_or_index");
  const edgeToNodeOffset = edgeFields.indexOf("to_node");
  // console.log(`[Nodes: ${numNodes}, Edges: ${numEdges}]`);
  //console.log(`Type: ${edgeTypeOffset} NameOrIndex: ${edgeNameOrIndexOffset} ToNode: ${edgeToNodeOffset}`);

  // Parse the snapshot into a graph.
  let nextEdge = 0;
  for (let i = 0; i < numNodes; i++) {
    const base = i * nodeFields.length;
    const nodeName = nodes[base + nodeNameOffset];
    // Node ID is like a pointer, I'm guessing.
    // Ignored for now.
    // const nodeId = nodes[base + nodeIdOffset];
    const nodeSelfSize = nodes[base + nodeSelfSizeOffset];
    const nodeType = nodes[base + nodeTypeOffset];
    const nodeEdgeCount = nodes[base + nodeEdgeCountOffset];
    visitor.visitNode(nodeType, nodeName, i, nodeSelfSize, nodeEdgeCount);
    const lastEdgeIndex = nextEdge + nodeEdgeCount;

    for (let j = nextEdge; j < lastEdgeIndex; j++) {
      const base = j * edgeFields.length;
      const edgeType: SnapshotEdgeType = edges[base + edgeTypeOffset];
      const edgeNameOrIndex = edges[base + edgeNameOrIndexOffset];
      const edgeToNode = edges[base + edgeToNodeOffset] / nodeFields.length;
      visitor.visitEdge(edgeType, edgeNameOrIndex, edgeToNode);
    }
    nextEdge = lastEdgeIndex;

    if (lastEdgeIndex > numEdges) {
      throw new Error(`Read past the edge array: ${lastEdgeIndex} > ${numEdges}`);
    }
  }

  return visitor.root;
}

/**
 * Given a list of strings, produces a map from index -> string pool ID.
 * @param strings List of strings
 */
function computeStringLookupTable(stringPool: Map<string, number>, stringPoolContents: string[], strings: string[]): Map<number, number> {
  const map = new Map<number, number>();
  for (let i = 0; i < strings.length; i++) {
    const str = strings[i];
    let id = stringPool.get(str);
    if (id === undefined) {
      // New string! Add to string pool.
      id = stringPoolContents.push(str) - 1;
      stringPool.set(str, id);
    }
    map.set(i, id);
  }
  return map;
}

/**
 * Tracks growing objects in the heap.
 *
 * Usage:
 *
 * - Call `addSnapshot` to add snapshots. The growth tracker will keep track of things that are growing.
 * - When done, call `getGrowthPaths`.
 *
 * For now, requires up to 3x the heap size in memory:
 *
 * - 1 for the growth tracker tree, which contains all live objects from all snapshots.
 * - 1 for the snapshot JSON, raw from the browser.
 * - 1 for the tree made from the JSON, which is in a format amenable to analysis.
 *
 * We can relax this to roughly 2x if we have the ability to stream in the snapshot JSON.
 */
export default class HeapGrowthTracker {
  // Lookup from string to ID in _strings array.
  private _stringPool = new Map<string, number>();
  // Contains all of the strings in all heaps.
  private _strings: string[] = [];
  // The root of the graph.
  private _graph: Node = null;

  public addSnapshot(snapshot: HeapSnapshot): void {
    const graph = constructGraph(snapshot, this._stringPool, this._strings);
    if (this._graph === null) {
      this._graph = graph;
    } else {
      MergeGraphs(this._graph, graph);
      this._graph = graph;
    }
  }

  public getGrowingObjects(): GrowthObject[] {
    return FindGrowingObjects(this._graph);
  }

  public rankGrowingObjects(objs: GrowthObject[]): Map<GrowthObject, [string, number][]> {
    return RankGrowingObjects(this._graph, objs);
  }

  public getGraph(): Node {
    return this._graph;
  }
}
