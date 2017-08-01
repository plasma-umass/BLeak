import {GrowthGraphBuilder, MergeGraphs, Node, GrowthObject, FindGrowingObjects, RankGrowingObjects} from './growth_graph';
import {SnapshotEdgeType, HeapSnapshot} from '../common/interfaces';
import {time} from '../common/util';

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
  snapshot.strings = null;
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
  console.log(`[Nodes: ${numNodes}, Edges: ${numEdges}]`);
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
    time(`Adding snapshot to growth graph`, () => {
      const graph = constructGraph(snapshot, this._stringPool, this._strings);
      if (this._graph === null) {
        this._graph = graph;
      } else {
        MergeGraphs(this._graph, graph);
        this._graph = graph;
      }
    });
  }

  public getGrowingObjects(): GrowthObject[] {
    return time(`Determine growing objects`, () => {
      return FindGrowingObjects(this._graph);
    });
  }

  public rankGrowingObjects(objs: GrowthObject[]): Map<GrowthObject, [string, number][]> {
    return RankGrowingObjects(this._graph, objs);
  }

  public getGraph(): Node {
    return this._graph;
  }
}
