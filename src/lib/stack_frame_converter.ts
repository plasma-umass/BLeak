import {SourceMapConsumer} from 'source-map';
import {StackFrame, parse as ErrorStackParser} from 'error-stack-parser';
import {IProxy} from '../common/interfaces';
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

  private async _fetchMap(proxy: IProxy, url: string): Promise<void> {
    if (typeof(url) !== "string") {
      return;
    }
    let map = this._maps.get(url);
    if (!map) {
      try {
        console.log(url);
        const file = await proxy.httpGet(url, undefined, undefined, true);
        const source = file.data.toString('utf8');
        let sourceMapOffset = source.lastIndexOf(magicString)
        if (sourceMapOffset > -1) {
          sourceMapOffset += magicString.length;
          const sourceMapBase64 = source.slice(sourceMapOffset);
          const sourceMapString = new Buffer(sourceMapBase64, 'base64').toString('utf8');
          const sourceMap = JSON.parse(sourceMapString);
          const consumer = new SourceMapConsumer(sourceMap);
          this._maps.set(url, consumer);
        }
      } catch (e) {
        // Failed to get map.
        console.error(`Failed to get source map for ${url}:`);
        console.error(e);
      }
    }
  }

  public async convertGrowthStacks(proxy: IProxy, stacks: {[p: number]: string[]}, agentUrl: string): Promise<{[p: string]: StackFrame[][]}> {
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
    await Promise.all(urlArray.map((url) => this._fetchMap(proxy, url)));
    Object.keys(convertedStacks).forEach((path) => {
      const stacks = convertedStacks[path];
      convertedStacks[path] = stacks.map((stack) => this._convertStack(stack));
    });
    return convertedStacks;
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