import GrowthTracker from '../lib/growth_tracker';
import {readFileSync} from 'fs';
import * as readline from 'readline';
import {SnapshotNodeTypeToString, SnapshotEdgeTypeToString, SnapshotNodeType} from '../common/interfaces';
import {path2string, time} from '../common/util';

const t = new GrowthTracker();
const files = process.argv.slice(2);
if (files.length === 0) {
  console.log(`Usage: ${process.argv[0]} ${process.argv[1]} snap1.heapsnapshot snap2.heapsnapshot [more *.heapsnapshots in order...]\n\nPrints out growing paths in the heap over several snapshots.`);
  process.exit();
}
for (const file of files) {
  console.log(`Processing ${file}...`);
  t.addSnapshot(JSON.parse(readFileSync(file, 'utf8')));
}

const growth = time('Get Growing Objects', () => t.getGrowingObjects());
const ranks = time('Rank Growing Objects', () => t.rankGrowingObjects(growth));
console.log(`Found ${growth.length} growing paths.`);
console.log(``);
console.log(`Report`);
console.log(`======`);
console.log(``);
ranks.forEach((ranks, obj) => {
  console.log(`* ${ranks.map((v) => `${v[0]}: ${v[1]}`).join(", ")}`);
  obj.paths.slice(0, 5).forEach((p, i) => {
    console.log(`   * ${path2string(p.toJSON(), true)}`);
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
let node = t.getGraph();
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
  const children = node.children ? node.children : [];
  console.log(`[..] Previous node, [h] ${hide ? "unhide system properties" : "hide system properties"}, [f (string)] Filter, [q] Quit`);
  let choices: string[][] = [];
  let sizes: number[] = [0, 0, 0, 0, 0];
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    // Skip some types of children.
    if (hide) {
      switch (child.to.type) {
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
      let choice = [`[${i}]`, `${child.indexOrName}`, `=[${SnapshotEdgeTypeToString(child.snapshotType)}]=>`, child.to.name, `[${SnapshotNodeTypeToString(child.to.type)}]${child.to.growing ? "*" : ""}`, `[Count: ${child.to.numProperties()}]`, `[New? ${child.to.isNew ? "Y" : "N"}]`, `[DV: ${child.to.leakReferences}]`];
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
      default:
        const choice = parseInt(a2, 10);
        const child = node.children[choice];
        if (!child) {
          console.log(`Invalid choice: ${choice}.`);
        } else {
          path.push(child.to);
        }
        break;
    }
    if (path.length === 0) {
      path.push(t.getGraph());
    }
    node = path[path.length - 1];
    runRound(filter);
  });
}
runRound();
