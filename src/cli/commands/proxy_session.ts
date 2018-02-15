import ChromeDriver from '../../lib/chrome_driver';
import {configureProxy} from '../../common/util';
import {readFileSync} from 'fs';
import {getConfigFromSource, getConfigBrowserInjection} from '../../lib/bleak';
import {CommandModule} from 'yargs';

interface CommandLineArgs {
  config: string;
  diagnose: boolean;
  fix: number[];
}

const ProxySession: CommandModule = {
  command: 'proxy-session',
  describe: 'Begins a browsing session through the BLeak proxy. Useful for debugging BLeak proxy issues.',
  builder: {
    config: {
      type: 'string',
      demand: true,
      describe: `Path to a BLeak configuration file`
    },
    diagnose: {
      type: 'boolean',
      default: false,
      describe: `If set to 'true', BLeak rewrites the webpage as it does during diagnoses`
    },
    fix: {
      type: 'number',
      array: true,
      default: [],
      describe: 'Which bug fixes to enable during the session'
    }
  },
  handler: async (args: CommandLineArgs) => {
    const rawConfig = readFileSync(args.config).toString();
    const config = getConfigFromSource(rawConfig);
    const url = config.url;
    const diagnose = args.diagnose;
    const fixes = args.fix;
    const driver = await ChromeDriver.Launch(console, false);
    configureProxy(driver.mitmProxy, console, diagnose, fixes, getConfigBrowserInjection(rawConfig), false, config.rewrite);
    await driver.navigateTo(url);
    await driver.debugLoop();
    await driver.shutdown();
  }
};

export default ProxySession;
