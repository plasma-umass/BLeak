import {CommandModule} from 'yargs';
import * as express from 'express';
import {createServer} from 'http';
import {resolve} from 'path';
import {existsSync, readFileSync} from 'fs';

interface CommandLineArgs {
  port: number;
}

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
  return p;
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
    app.use(express.static(findPath()));
    createServer(app).listen(port, function() {
      console.log(`Visit the viewer in your favorite web browser at http://localhost:${port}/`);
    });
  }
};

export default Viewer;
