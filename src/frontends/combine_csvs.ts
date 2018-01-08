import {readFileSync, createWriteStream} from 'fs';
import * as yargs from 'yargs';

interface CommandLineArgs {
  out: string;
  _: string[];
}

const args: CommandLineArgs = <any> yargs.number('proxy-port')
  .usage("$0 --out [file.csv] [snap1.json.gz] [snap2.json.gz] ...")
  .string('out')
  .describe('out', `File to output combined CSV to.`)
  .demand('out')
  .help('help')
  .parse(process.argv);

async function main() {
  const files = args._.slice(2);
  const out = createWriteStream(args.out);
  let first = true;
  for (const f of files) {
    const data = readFileSync(f, 'utf8');
    if (first) {
      first = false;
      out.write(data);
    } else {
      out.write(data.slice(data.indexOf('\n') + 1));
    }
  }
  out.end();
}

main();
