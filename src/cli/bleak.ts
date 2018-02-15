import * as yargs from 'yargs';
import RunCommand from './commands/run';
import FindGrowingPaths from './commands/find_growing_paths';
import ProxySession from './commands/proxy_session';
import TransformJavaScript from './commands/transform_javascript';
import Viewer from './commands/viewer';

yargs.command(RunCommand)
     .command(FindGrowingPaths)
     .command(ProxySession)
     .command(TransformJavaScript)
     .command(Viewer)
     .demandCommand(1)
     .help('help').argv;
