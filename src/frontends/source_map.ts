import {SourceMapConsumer} from 'source-map';
import {readFileSync} from 'fs';

const map = JSON.parse(readFileSync(process.argv[2], "utf8"));
const consumer = new SourceMapConsumer(map);
const op = consumer.generatedPositionFor({
  source: consumer.sources[0],
  line: parseInt(process.argv[3], 10),
  column: parseInt(process.argv[4], 10)
});

console.log(`${process.argv[3]}:${process.argv[4]} => ${op.line}:${op.column}`);
