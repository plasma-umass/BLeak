import {HeapGrowthTracker, pathToString} from '../lib/growth_graph';
import {createReadStream} from 'fs';
import * as readline from 'readline';
import {SnapshotNodeTypeToString, SnapshotEdgeTypeToString, SnapshotNodeType} from '../common/interfaces';
import {time} from '../common/util';
import HeapSnapshotParser from '../lib/heap_snapshot_parser';
import {createGunzip} from 'zlib';

function getHeapSnapshotParser(file: string): HeapSnapshotParser {
  const parser = new HeapSnapshotParser();
  const stream = createReadStream(file).pipe(createGunzip());
  stream.on('data', function(d) {
    parser.addSnapshotChunk(d.toString());
  });
  return parser;
}

async function main() {
  const t = new HeapGrowthTracker();
  const files = process.argv.slice(2);
  if (files.length === 0) {
    console.log(`Usage: ${process.argv[0]} ${process.argv[1]} snap1.heapsnapshot.gz snap2.heapsnapshot.gz [more *.heapsnapshots.gz in order...]\n\nPrints out growing paths in the heap over several snapshots.`);
    process.exit();
  }
  for (const file of files) {
    console.log(`Processing ${file}...`);
    await t.addSnapshot(getHeapSnapshotParser(file));
  }

  const growth = time('Get Growing Objects', () => t.getGrowingPaths());
  console.log(`Found ${growth.length} growing paths.`);
  console.log(``);
  console.log(`Report`);
  console.log(`======`);
  console.log(``);
  growth.sort((a, b) => b.adjustedRetainedSize - a.adjustedRetainedSize).forEach((obj) => {
    console.log(`* Adjusted Retained Size: ${obj.adjustedRetainedSize}, Retained Size: ${obj.retainedSize}, Transitive Closure Size: ${obj.transitiveClosureSize}`);
    obj.paths.slice(0, 5).forEach((p, i) => {
      console.log(`   * ${pathToString(p)}`);
    });
    if (obj.paths.length > 5) {
      console.log(`   * (${obj.paths.length - 5} more...)`);
    }
  });

  console.log(`Exploring the heap!`);
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  let heap = t.getGraph();
  let node = heap.getRoot();
  let path = [node];
  let hide = true;
  const MAX_COL_SIZE = 25;
  function pad(str: string, len: number): string {
    let str2 = str.replace(/\n/g, ' ').slice(0, len);
    for (let i = str.length; i < len; i++) {
      str2 += " ";
    }
    return str2;
  }
  function column(strs: string[], lens: number[]): string {
    let out = "";
    for (let i = 0; i < strs.length; i++) {
      out += pad(strs[i], lens[i]) + " ";
    }
    return out;
  }
  function runRound(filter?: string) {
    console.log(`Current Node: ${node.name} [${SnapshotNodeTypeToString(node.type)}]`);
    console.log(`[..] Previous node, [h] ${hide ? "unhide system properties" : "hide system properties"}, [f (string)] Filter, [q] Quit`);
    let choices: string[][] = [];
    let sizes: number[] = [0, 0, 0, 0, 0];
    let i = -1;
    for (const it = node.children; it.hasNext(); it.next()) {
      i++;
      const child = it.item();
      const to = child.to;
      // Skip some types of children.
      if (hide) {
        switch (to.type) {
          //case SnapshotNodeType.Code:
          case SnapshotNodeType.ConsString:
          case SnapshotNodeType.HeapNumber:
          case SnapshotNodeType.Hidden:
          case SnapshotNodeType.RegExp:
          case SnapshotNodeType.SlicedString:
          case SnapshotNodeType.String:
            continue;
        }
      }
      if (!filter || `${child.indexOrName}`.toLowerCase().indexOf(filter) !== -1) {
        let choice = [`[${i}]`, `${child.indexOrName}`, `=[${SnapshotEdgeTypeToString(child.snapshotType)}]=>`, to.name, `[${SnapshotNodeTypeToString(to.type)}]${t.isGrowing(to.nodeIndex) ? "*" : ""}`, `[Count: ${to.numProperties()}]`, `[Non-leak-reachable? ${t._nonLeakVisits.get(to.nodeIndex)}, Leak visits: ${t._leakRefs[to.nodeIndex]}, NI: ${to.nodeIndex}]`];
        choices.push(choice);
        for (let j = 0; j < choice.length; j++) {
          if (choice[j].length > sizes[j]) {
            sizes[j] = choice[j].length;
            if (sizes[j] > MAX_COL_SIZE) {
              sizes[j] = MAX_COL_SIZE;
            }
          }
        }
      }
    }
    for (const choice of choices) {
      console.log(column(choice, sizes));
    }

    rl.question("? ", (a) => {
      const a2 = a.trim().toLowerCase();
      let filter: string | undefined = undefined;
      switch (a2[0]) {
        case '.':
          if (a2[1] === '.') {
            path.pop();
          }
          break;
        case 'q':
          rl.close();
          process.exit();
          break;
        case 'h':
          hide = !hide;
          break;
        case 'f': {
          filter = a2.slice(2).trim();
          break;
        }
        case 's': {
          const latest = path[path.length - 1];
          latest.nodeIndex = <any> parseInt(a2.slice(2).trim(), 10);
          path = [heap.getRoot(), latest];
          break;
        }
        default:
          const choice = parseInt(a2, 10);
          const child = node.getChild(choice);
          if (!child) {
            console.log(`Invalid choice: ${choice}.`);
          } else {
            path.push(child.to);
          }
          break;
      }
      if (path.length === 0) {
        path.push(heap.getRoot());
      }
      node = path[path.length - 1];
      runRound(filter);
    });
  }
  runRound();
}

main();
