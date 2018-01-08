import {parse} from 'papaparse';
import {readFileSync} from 'fs';

interface Result {
  iterationCount: number;
  leaksFixed: string;
  program: string;
  totalSize: number;
}

const data = readFileSync(process.argv[2], 'utf8');
const dataParsed = parse(data, {
  header: true,
  dynamicTyping: true
});
const results: Result[] = dataParsed.data;
const dataSorted = new Map<string, Result[]>();
results.forEach((r) => {
  if (!r) {
    return;
  }
  let arr = dataSorted.get(r.program);
  if (!arr) {
    arr = [];
    dataSorted.set(r.program, arr);
  }
  arr.push(r);
});
/*function resultFilter(a: Result): boolean {
  return a.iterationCount > 0;
}
function resultSort(a: Result, b: Result): number {
  if (a.leaksFixed !== b.leaksFixed) {
    if (a.leaksFixed === 'None') {
      return -1;
    } else {
      return 1;
    }
  }
  return a.iterationCount - b.iterationCount;
}*/
console.log(`program,leaksFixed,iterationCount,growth`);
dataSorted.forEach((r) => {
  //const sorted = r.filter(resultFilter).sort(resultSort);
  // Calculate average growth.
  /*for (let i = 1; i < sorted.length && sorted[i].leaksFixed == ; i++) {
    const item = sorted[i];
    console.log(`"${item.program}",${item.leaksFixed},${item.iterationCount},${item.totalSize - sorted[i - 1].totalSize}`);
  }*/
});
