import GrowthTracker from '../lib/growth_tracker';
import {readFileSync} from 'fs';
import * as readline from 'readline';
import {SnapshotNodeTypeToString, SnapshotEdgeTypeToString, SnapshotNodeType} from '../common/interfaces';

const t = new GrowthTracker();
const files = process.argv.slice(2);
for (const file of files) {
  console.log(`Processing ${file}...`);
  t.addSnapshot(JSON.parse(readFileSync(file, 'utf8')));
}
const growth = t.getGrowthPaths();
console.log(`Found ${growth.length} growing paths.`);
for (const g of growth) {
  console.log(g.getAccessString());
}

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
function runRound() {
  console.log(`Current Node: ${node.name} [${SnapshotNodeTypeToString(node.type)}]`);
  const children = node.children ? node.children : [];
  console.log(`[..] Previous node, [h] ${hide ? "unhide system properties" : "hide system properties"}, [q] Quit`);
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
    let choice = [`[${i}]`, `${child.indexOrName}`, `=[${SnapshotEdgeTypeToString(child.snapshotType)}]=>`, child.to.name, `[${SnapshotNodeTypeToString(child.to.type)}]`];
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
  for (const choice of choices) {
    console.log(column(choice, sizes));
  }

  rl.question("? ", (a) => {
    const a2 = a.trim().toLowerCase();
    switch (a2) {
      case '..':
        path.pop();
        break;
      case 'q':
        rl.close();
        process.exit();
        break;
      case 'h':
        hide = !hide;
        break;
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
    runRound();
  });
}
runRound();
