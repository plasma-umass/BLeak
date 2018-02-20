import ChromeDriver from '../../lib/chrome_driver';
import getInterceptor from '../../lib/mitmproxy_interceptor';
import {readFileSync} from 'fs';
import {CommandModule} from 'yargs';
import BLeakConfig from '../../lib/bleak_config';
import {DEFAULT_AGENT_URL, DEFAULT_BABEL_POLYFILL_URL, DEFAULT_AGENT_TRANSFORM_URL} from '../../lib/mitmproxy_interceptor';

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
    const config = BLeakConfig.FromSource(rawConfig);
    const url = config.url;
    const diagnose = args.diagnose;
    const fixes = args.fix;
    const driver = await ChromeDriver.Launch(console, false, 1920, 1080, ['/eval', DEFAULT_AGENT_URL, DEFAULT_BABEL_POLYFILL_URL, DEFAULT_AGENT_TRANSFORM_URL]);
    driver.mitmProxy.cb = getInterceptor({
      log: console,
      rewrite: diagnose,
      fixes: fixes,
      config: config.getBrowserInjection(),
      disableAllRewrites: false,
      fixRewriteFunction: config.rewrite
    });
    await driver.navigateTo(url);
    await driver.debugLoop();
    await driver.shutdown();
  }
};

export default ProxySession;
