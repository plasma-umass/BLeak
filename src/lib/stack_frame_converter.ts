import {SourceMapConsumer} from 'source-map';
import {StackFrame, parse as ErrorStackParser} from 'error-stack-parser';
import {get as httpGet} from 'http';
import {IProxy} from '../common/interfaces';
import {parse as parseURL} from 'url';
import {DEFAULT_AGENT_URL} from './transformations';

const magicString = '//# sourceMappingURL=data:application/json;base64,';

/**
 * Converts stack frames to get the position in the original source document.
 * Strips any frames from the given agent string.
 */
export default class StackFrameConverter {
  private _maps = new Map<string, SourceMapConsumer>();

  public static ConvertGrowthStacks(proxy: IProxy, stacks: {[p: number]: string[]}, agentUrl: string = DEFAULT_AGENT_URL): Promise<{[p: string]: StackFrame[][]}> {
    return new StackFrameConverter().convertGrowthStacks(proxy, stacks, agentUrl);
  }

  private _fetchMap(proxy: IProxy, url: string): Promise<undefined> {
    return new Promise((res, rej) => {
      if (typeof(url) !== "string") {
        return res();
      }
      let map = this._maps.get(url);
      if (!map) {
        const parsedUrl = parseURL(url);
        const req = httpGet({
          host: "localhost",
          port: proxy.getHTTPPort(),
          path: url,
          headers: {
            Host: parsedUrl.host
          }
        }, (incomingMessage) => {
          let chunks: Buffer[] = [];
          incomingMessage.on('data', (chunk) => {
            if (Buffer.isBuffer(chunk)) {
              chunks.push(chunk);
            } else {
              chunks.push(new Buffer(chunk, 'utf8'));
            }
          }).on('end', () => {
            try {
              // NEED TO REQUEST FROM PROXY!!!
              const source = Buffer.concat(chunks).toString('utf8');
              let sourceMapOffset = source.lastIndexOf(magicString)
              if (sourceMapOffset > -1) {
                sourceMapOffset += magicString.length;
                const sourceMapBase64 = source.slice(sourceMapOffset);
                const sourceMapString = new Buffer(sourceMapBase64, 'base64').toString('utf8');
                const sourceMap = JSON.parse(sourceMapString);
                const consumer = new SourceMapConsumer(sourceMap);
                this._maps.set(url, consumer);
              } else {
                // console.log(`${url} does not have any source map...`);
              }
            } catch (e) {
              // console.log(`ERROR: ${e}`);
            }
            res();
          }).on('error', (e) => { res(); });
        });
        req.on('error', (e) => { res(); });
      } else {
        res();
      }
    });
  }

  public convertGrowthStacks(proxy: IProxy, stacks: {[p: number]: string[]}, agentUrl: string): Promise<{[p: string]: StackFrame[][]}> {
    // First pass: Get all unique URLs and their source maps.
    const urls = new Set<string>();
    const convertedStacks: {[p: string]: StackFrame[][]} = {};
    Object.keys(stacks).forEach((path) => {
      const pathStacks = stacks[parseInt(path, 10)];
      convertedStacks[path] = pathStacks.map((stack) => {
        const frames = ErrorStackParser(<any> {stack: stack})
          .filter((f) => f.fileName ? f.fileName.indexOf(agentUrl) === -1 : true)
          .filter((f) => f.functionName ? f.functionName.indexOf("eval") === -1 || f.functionName.indexOf(agentUrl) === -1 : true);
        frames.forEach((frame) => {
          urls.add(frame.fileName);
        });
        return frames;
      });
    });
    const urlArray: string[] = [];
    urls.forEach((url) => urlArray.push(url));
    return Promise.all(urlArray.map((url) => this._fetchMap(proxy, url))).then(() => {
      Object.keys(convertedStacks).forEach((path) => {
        const stacks = convertedStacks[path];
        convertedStacks[path] = stacks.map((stack) => this._convertStack(stack));
      });
      return convertedStacks;
    });
  }

  private _convertStack(stack: StackFrame[]): StackFrame[] {
    return stack.map((frame) => this._convertStackFrame(frame));
  }

  private _convertStackFrame(frame: StackFrame): StackFrame {
    const map = this._maps.get(frame.fileName);
    if (!map) {
      return frame;
    }
    const ogPos = map.originalPositionFor({
      line: frame.lineNumber,
      column: frame.columnNumber
    });
    frame.lineNumber = ogPos.line;
    frame.columnNumber = ogPos.column;
    return frame;
  }
}