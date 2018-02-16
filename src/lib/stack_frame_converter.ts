import {SourceMapConsumer, RawSourceMap} from 'source-map';
import {StackFrame, parse as ErrorStackParser} from 'error-stack-parser';
import {DEFAULT_AGENT_URL} from './mitmproxy_interceptor';
import {resolve as resolveURL} from 'url';
import BLeakResults from './bleak_results';
import {IStack} from '../common/interfaces';
import MITMProxy from 'mitmproxy';

const magicString = '//# sourceMappingURL=data:application/json;base64,';

/**
 * Converts stack frames to get the position in the original source document.
 * Strips any frames from the given agent string.
 */
export default class StackFrameConverter {
  private _maps = new Map<string, SourceMapConsumer>();

  /**
   * Converts the raw stack frames from the BLeak-instrumented source code of the application to the
   * application's original source code.
   *
   * Stores relevant StackFrame / source file data into the `results` object, and returns the stack frames
   * in results format.
   * @param proxy
   * @param pageUrl
   * @param results
   * @param traces
   * @param agentUrl
   */
  public static ConvertGrowthStacks(proxy: MITMProxy, pageUrl: string, results: BLeakResults, traces: GrowingStackTraces, agentUrl: string = DEFAULT_AGENT_URL): {[id: number]: IStack[]} {
    return new StackFrameConverter(results).convertGrowthStacks(proxy, pageUrl, traces, agentUrl);
  }

  constructor(
    private _results: BLeakResults
  ) {}

  private _fetchMap(proxy: MITMProxy, url: string): void {
    if (typeof(url) !== "string") {
      return;
    }
    let map = this._maps.get(url);
    if (!map) {
      try {
        const stashedItem = proxy.getFromStash(url);
        const source = stashedItem.data.toString();
        let sourceMapOffset = source.lastIndexOf(magicString)
        if (sourceMapOffset > -1) {
          sourceMapOffset += magicString.length;
          const sourceMapBase64 = source.slice(sourceMapOffset);
          const sourceMapString = new Buffer(sourceMapBase64, 'base64').toString('utf8');
          const sourceMap: RawSourceMap = JSON.parse(sourceMapString);
          const consumer = new SourceMapConsumer(sourceMap);
          this._maps.set(url, consumer);
          if (sourceMap.sourcesContent && sourceMap.sourcesContent.length > 0) {
            const len = sourceMap.sourcesContent.length;
            for (let i = 0; i < len; i++) {
              this._results.addSourceFile(url, stashedItem.isJavaScript ? "text/javascript" : "text/html", sourceMap.sourcesContent[i]);
            }
          }
        } else {
          this._results.addSourceFile(url, stashedItem.isJavaScript ? "text/javascript" : "text/html", source);
        }
      } catch (e) {
        // Failed to get map.
        console.error(`Failed to get source map for ${url}:`);
        console.error(e);
      }
    }
  }

  public convertGrowthStacks(proxy: MITMProxy, pageUrl: string, traces: GrowingStackTraces, agentUrl: string): {[id: number]: IStack[]} {
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
    const convertedStacks = new Map<string, IStack>();
    rawStacks.forEach((stack, k) => {
      convertedStacks.set(k, this._convertStack(stack));
    });
    // Step 4: Map stacks back into the return object.
    function mapStack(s: string): IStack {
      return convertedStacks.get(s);
    }
    const rv: {[id: number]: IStack[]} = {};
    Object.keys(traces).forEach((stringId) => {
      const id = parseInt(stringId, 10);
      rv[id] = traces[id].map(mapStack);
    });

    return rv;
  }

  private _convertStack(stack: StackFrame[]): IStack {
    return stack.map((frame) => this._convertStackFrame(frame));
  }

  private _convertStackFrame(frame: StackFrame): number {
    const map = this._maps.get(frame.fileName);
    if (!map) {
      return this._results.addStackFrameFromObject(frame);
    }
    const ogPos = map.originalPositionFor({
      line: frame.lineNumber,
      column: frame.columnNumber
    });
    frame.lineNumber = ogPos.line;
    frame.columnNumber = ogPos.column;
    return this._results.addStackFrameFromObject(frame);
  }
}