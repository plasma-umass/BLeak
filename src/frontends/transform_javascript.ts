import {readFileSync} from 'fs';
import {exposeClosureState} from '../lib/transformations';

const inputFile = process.argv[2];
if (!inputFile) {
  console.log("Must specify input file");
  process.exit(1);
}

const data = readFileSync(inputFile, 'utf8');
console.log(exposeClosureState("file.js", data));
