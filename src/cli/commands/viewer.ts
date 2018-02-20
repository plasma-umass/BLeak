import {CommandModule} from 'yargs';
import * as express from 'express';
import {createServer} from 'http';
import {resolve, join, dirname} from 'path';
import {existsSync, readFileSync} from 'fs';

interface CommandLineArgs {
  port: number;
}

// Easiest way to get the folder of a Node module, wherever it may reside.
const DEVTOOLS_FRONTEND_DIR = dirname(require.resolve('chrome-devtools-frontend/package.json'));

function findPath(): string {
  let p = resolve(__dirname, '..');
  function checkForPackage() {
    const pkg = resolve(p, 'package.json');
    if (existsSync(pkg)) {
      try {
        return JSON.parse(readFileSync(pkg, 'utf8')).name === 'bleak-detector';
      } catch (e) {
        return false;
      }
    }
    return false;
  }
  let max = 5;
  while (!checkForPackage()) {
    --max;
    if (max <= 0) {
      throw new Error(`Unable to locate proper directory for serving the viewer.`)
    }
    p = resolve(p, '..');
  }
  return join(p, 'dist', 'viewer');
}

const Viewer: CommandModule = {
  command: 'viewer',
  describe: 'Runs an HTTP server hosting the BLeak results viewer',
  builder: {
    port: {
      type: 'number',
      default: 8889,
      describe: 'What port to run the HTTP server on.'
    }
  },
  handler: (args: CommandLineArgs) => {
    const port = args.port;
    const app = express();
    app.use('/chrome-devtools-frontend', express.static(DEVTOOLS_FRONTEND_DIR));
    app.use(express.static(findPath()));
    createServer(app).listen(port, function() {
      console.log(`Visit the viewer in your favorite web browser at http://localhost:${port}/ (CTRL+C to close)`);
    });
  }
};

export default Viewer;
