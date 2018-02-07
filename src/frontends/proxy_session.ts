import ChromeDriver from '../lib/chrome_driver';
import {configureProxy} from '../common/util';
import * as yargs from 'yargs';
import {readFileSync} from 'fs';
import {getConfigFromSource, getConfigBrowserInjection} from '../lib/bleak';

interface CommandLineArgs {
  config: string;
  diagnose: boolean;
  fix: number[];
}

const args: CommandLineArgs = <any> yargs.number('proxy-port')
  .usage("$0 [options] --config [config.js]")
  .string('config')
  .describe('config', `Path to a BLeak configuration file`)
  .demand('config')
  .boolean('diagnose')
  .default('diagnose', false)
  .describe('diagnose', `If set to 'true', BLeak rewrites the webpage as it does during diagnoses`)
  .number('fix')
  .array('fix')
  .default('fix', [])
  .describe('fix', `Which bug fixes to enable during the session`)
  .help('help')
  .parse(process.argv);

const rawConfig = readFileSync(args.config).toString();
const config = getConfigFromSource(rawConfig);
const url = config.url;
const diagnose = args.diagnose;
const fixes = args.fix;

async function main() {
  const driver = await ChromeDriver.Launch(console, false);
  configureProxy(driver.mitmProxy, console, diagnose, fixes, getConfigBrowserInjection(rawConfig), false, config.rewrite);
  await driver.navigateTo(url);
  await driver.debugLoop();
  await driver.shutdown();
}

main();
