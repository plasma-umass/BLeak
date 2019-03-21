import { readFileSync, createWriteStream } from "fs";
import { CommandModule } from "yargs";
import HeapSnapshotParser from "../../lib/heap_snapshot_parser";
import { HeapGraph } from "../../lib/growth_graph";
import ConsoleLog from "../../common/console_log";

interface CommandLineArgs {
  in: string;
  outNode: string;
  outEdge: string;
}

const COMMA_QUOTE_REPLACE = /(,|")/g;

const ProduceHeapGraph: CommandModule = {
  command: "process-heap-graph",
  describe: "Fun tool that produces a CSV file of the heap.",
  builder: {
    in: {
      type: "string",
      demand: true,
      describe: `Path to a Chrome heap snapshot`
    },
    outNode: {
      type: "string",
      demand: true,
      describe: "Path where a CSV file of nodes will be written"
    },
    outEdge: {
      type: "string",
      demand: true,
      describe: "Path where a CSV file of edges will be written"
    }
  },
  handler: async (args: CommandLineArgs) => {
    const hsp = HeapSnapshotParser.FromString(readFileSync(args.in, "utf8"));
    const graph = await HeapGraph.Construct(hsp, ConsoleLog);
    const nodeStream = createWriteStream(args.outNode);
    nodeStream.write(`Id,Label\n`);
    const edgeStream = createWriteStream(args.outEdge);
    edgeStream.write(`Source,Target,Label\n`);
    let count = 0;
    let edgeCount = 0;
    graph.visitUserRoots(n => {
      nodeStream.write(
        `${n.nodeIndex},${JSON.stringify(
          n.name.replace(COMMA_QUOTE_REPLACE, "")
        )}\n`
      );
      count++;
      edgeCount += n.childrenLength;
      for (const it = n.children; it.hasNext(); it.next()) {
        const edge = it.item();
        edgeStream.write(
          `${n.nodeIndex},${edge.toIndex},${JSON.stringify(
            edge.indexOrName.toString().replace(COMMA_QUOTE_REPLACE, "")
          )}\n`
        );
      }
    });
    nodeStream.close();
    edgeStream.close();
    console.log(`${count} nodes, ${edgeCount} edges`);
  }
};

export default ProduceHeapGraph;
