import {existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync} from 'fs';
import {join} from 'path';

import * as yargs from 'yargs';

interface Options {
  in: string;
  out: string;
}

const args = <Options> <any> yargs
  .string('in')
  .demand('in')
  .describe('in', 'Input folder of files with source maps')
  .string('out')
  .demand('out')
  .describe('out', 'Output folder to put extracted source')
  .help('help')
  .parse(process.argv);

if (!existsSync(args.out)) {
  mkdirSync(args.out);
}

const magicString = "//# sourceMappingURL=data:application/json;base64,";
readdirSync(args.in).filter((s) => {
  const q = s.indexOf('?');
  if (q !== -1) {
    s = s.slice(0, q - 1);
  }
  return s.slice(-2).toLowerCase() === 'js';
}).forEach((s, index, arr) => {
  console.log(`[${index + 1} / ${arr.length}]: ${s}`);
  try {
    const d = readFileSync(join(args.in, s), 'utf8');
    // Locate magic string.
    //# sourceMappingURL=data:application/json;base64,
    const beginSourceMap = d.lastIndexOf(magicString);
    if (beginSourceMap !== -1) {
      // sourcesContent
      const sourceMap = JSON.parse(Buffer.from(d.slice(beginSourceMap + magicString.length), 'base64').toString());
      if (sourceMap.sourcesContent.length > 1) {
        console.warn(`Multiple source files in map. Only writing one.`)
      }
      if (sourceMap.sourcesContent.length > 0) {
        writeFileSync(join(args.out, s), Buffer.from(sourceMap.sourcesContent[0], 'utf8'));
      } else {
        console.warn(`No sources inlined into source map.`)
      }
    } else {
      console.warn(`No source map found.`);
    }
  } catch (e) {
    console.warn(`Couldn't read file: ${e}`);
  }
});