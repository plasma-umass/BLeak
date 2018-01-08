import * as yargs from 'yargs';
import {readFileSync} from 'fs';
import {LeakJSON} from '../common/interfaces';

const args = yargs
  .usage("$0 --in file.json --inmetric [leak_share|retained|transitive_closure] [rank list to translate from]")
  .string("in")
  .describe("in", 'Input JSON file to parse')
  .demand('in')
  .string("inmetric")
  .describe("inmetric", "Input ranking")
  .demand('inmetric')
  .help('help')
  .parse(process.argv);

const ranking = args._.slice(2);
const json: LeakJSON = JSON.parse(readFileSync(args.in, 'utf8'));

const leakShare = json.leaks.slice(0).sort((a, b) => b.scores.leak_growth - a.scores.leak_growth);
const retainedSize = json.leaks.slice(0).sort((a, b) => b.scores.retained_size - a.scores.retained_size);
const transitiveClosure = json.leaks.slice(0).sort((a, b) => b.scores.transitive_closure - a.scores.transitive_closure);
const ranks = {
  leak_share: leakShare,
  retained: retainedSize,
  transitive_closure: transitiveClosure
};

if (ranking.length !== json.leaks.length) {
  console.error(`Invalid input ranking.`);
  process.exit(1);
}

const oracle = ranks[(<"leak_share" | "retained" | "transitive_closure"> args.inmetric.toLowerCase())];
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

others.forEach((k: "leak_share" | "retained" | "transitive_closure") => {
  console.log(k);
  console.log(`[${compare(oracle, ranks[k]).join(",")}]`);
});
