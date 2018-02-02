import * as yargs from 'yargs';
import {readFileSync} from 'fs';
import {IBLeakResults} from '../common/interfaces';

const args = yargs
  .usage("$0 --in bleak_results.json --inmetric [leakShare|retainedSize|transitiveClosureSize] [rank list to translate from]")
  .string("in")
  .describe("in", 'Input JSON file to parse')
  .demand('in')
  .string("inmetric")
  .describe("inmetric", "Input ranking")
  .demand('inmetric')
  .help('help')
  .parse(process.argv);

const ranking = args._.slice(2);
const json: IBLeakResults = JSON.parse(readFileSync(args.in, 'utf8'));

const leakShare = json.leaks.slice(0).sort((a, b) => b.scores.leakShare - a.scores.leakShare);
const retainedSize = json.leaks.slice(0).sort((a, b) => b.scores.retainedSize - a.scores.retainedSize);
const transitiveClosure = json.leaks.slice(0).sort((a, b) => b.scores.transitiveClosureSize - a.scores.transitiveClosureSize);
const ranks = {
  leakShare: leakShare,
  retainedSize: retainedSize,
  transitiveClosureSize: transitiveClosure
};

if (ranking.length !== json.leaks.length) {
  console.error(`Invalid input ranking.`);
  process.exit(1);
}

const oracle = ranks[(<"leakShare" | "retainedSize" | "transitiveClosureSize"> args.inmetric.toLowerCase())];
if (!oracle) {
  console.error(`Invalid ranking metric: ${args.inmetric}`);
  process.exit(1);
}
const others = Object.keys(ranks).filter((k) => k !== args.inmetric.toLowerCase());

function compare(inLeaks: typeof oracle, outLeaks: typeof oracle): string[] {
  return outLeaks.map((ol) => {
    return ranking[inLeaks.indexOf(ol)];
  });
}

others.forEach((k: "leakShare" | "retainedSize" | "transitiveClosureSize") => {
  console.log(k);
  console.log(`[${compare(oracle, ranks[k]).join(",")}]`);
});
