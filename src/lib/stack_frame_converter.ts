import {SourceMapConsumer} from 'source-map';
import {StackFrame, parse as ErrorStackParser} from 'error-stack-parser';
import {DEFAULT_AGENT_URL} from '../common/util';
import {resolve as resolveURL} from 'url';
import MITMProxy from 'mitmproxy';

const magicString = '//# sourceMappingURL=data:application/json;base64,';

/**
 * Converts stack frames to get the position in the original source document.
 * Strips any frames from the given agent string.
 */
export default class StackFrameConverter {
  private _maps = new Map<string, SourceMapConsumer>();

  public static ConvertGrowthStacks(proxy: MITMProxy, pageUrl: string, traces: GrowingStackTraces, agentUrl: string = DEFAULT_AGENT_URL): {[id: number]: StackFrame[][]} {
    return new StackFrameConverter().convertGrowthStacks(proxy, pageUrl, traces, agentUrl);
  }

  private _fetchMap(proxy: MITMProxy, url: string): void {
    if (typeof(url) !== "string") {
      return;
    }
    let map = this._maps.get(url);
    if (!map) {
      try {
        const source = proxy.getFromStash(url).data.toString();
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

  public convertGrowthStacks(proxy: MITMProxy, pageUrl: string, traces: GrowingStackTraces, agentUrl: string): {[id: number]: StackFrame[][]} {
    // First pass: Get all unique URLs and their source maps.
    const urls = new Set<string>();
    const rawStacks = new Map<string, StackFrame[]>();

    function frameFilter(f: StackFrame): boolean {
      return (!f.fileName || f.fileName.indexOf(agentUrl) === -1) && (!f.functionName || (f.functionName.indexOf("eval") === -1 && f.functionName.indexOf(agentUrl) === -1));
    }

    function processFrame(f: StackFrame) {
      if (f.fileName && !f.fileName.toLowerCase().startsWith("http")) {
        f.fileName = resolveURL(pageUrl, f.fileName);
      }
      urls.add(f.fileName);
    }

    function processStack(s: string): void {
      if (!rawStacks.has(s)) {
        const frames = ErrorStackParser(<any> {stack: s}).filter(frameFilter);
        frames.forEach(processFrame);
        rawStacks.set(s, frames);
      }
    }

    // Step 1: Collect all URLs.
    Object.keys(traces).forEach((stringId) => {
      const id = parseInt(stringId, 10);
      traces[id].forEach(processStack);
    });
    // Step 2: Get files, parse source maps.
    urls.forEach((url) => {
      this._fetchMap(proxy, url);
    });
    // Step 3: Convert stacks.
    const convertedStacks = new Map<string, StackFrame[]>();
    rawStacks.forEach((stack, k) => {
      convertedStacks.set(k, this._convertStack(stack));
    });
    // Step 4: Return data!
    function mapStack(s: string): StackFrame[] {
      return convertedStacks.get(s);
    }
    const rv: {[id: number]: StackFrame[][]} = {};
    Object.keys(traces).forEach((stringId) => {
      const unique = new Set<string>();
      const id = parseInt(stringId, 10);
      // Some traces may be identical after normalization (e.g., removing frames that are from bleak-agent).
      // Strip those here.
      rv[id] = traces[id].map(mapStack).filter((s) => {
        const str = this._getString(s);
        if (unique.has(str)) {
          return false;
        }
        unique.add(str);
        return true;
      });
    });
    return rv;
  }

  private _getString(s: StackFrame[]): string {
    return s.map((f) => {
      return `${f.functionName} ${f.fileName}:${f.lineNumber}:${f.columnNumber}`;
    }).join("\n");
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