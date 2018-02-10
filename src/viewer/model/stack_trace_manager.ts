import {IStackFrame} from '../../common/interfaces';
import BLeakResults from '../../lib/bleak_results';
import LeakRoot from '../../lib/leak_root';

class StackFrameStats {
  constructor(
    // This stack frame's unique ID
    public readonly id: number,
    // The LeakRoots that reference this stack frame
    public readonly leaks: LeakRoot[],
    // The number of stacks that reference this stack frame
    public count: number) {}
}

/**
 * Stores a set of stack traces associated with specific memory leaks.
 *
 * Supports:
 * - Looking up the leaks associated with a given source location
 * - Returning all of the stack frames located in a specific file
 * - Returning the stack traces associated with a specific leak
 */
export default class StackTraceManager {
  public static FromBLeakResults(results: BLeakResults): StackTraceManager {
    return new StackTraceManager(results.stackFrames, results.leaks);
  }

  private _frameStats: StackFrameStats[];
  private _fileStackFrames: {[url: string]: number[]} = {};
  private _locationToId = new Map<string, number>();
  constructor(
    private _frames: IStackFrame[],
    private _leaks: LeakRoot[]
  ) {
    this._frameStats = this._frames.map((f, id) => new StackFrameStats(id, [], 0));
    this._leaks.forEach((l) => {
      l.stacks.forEach((s) => {
        for (const sf of s) {
          const stats = this._frameStats[sf];
          stats.count++;
          if (stats.leaks.indexOf(l) === -1) {
            stats.leaks.push(l);
          }
          const sfObj = this._frames[sf];
          let fileStackFrames = this._fileStackFrames[sfObj[0]];
          if (!fileStackFrames) {
            fileStackFrames = this._fileStackFrames[sfObj[0]] = [];
          }
          // TODO: Could use a set, but these arrays are expected to be small.
          if (fileStackFrames.indexOf(sf) === -1) {
            fileStackFrames.push(sf);
          }
          this._locationToId.set(`${sfObj[0]}:${sfObj[1]}:${sfObj[2]}`, sf);
        }
      });
    });
  }

  private _getFrameForLocation(url: string, line: number, column: number): number {
    return this._locationToId.get(`${url}:${line}:${column}`);
  }

  public getLeaksForLocation(url: string, line: number, column: number): LeakRoot[] {
    const sfId = this._getFrameForLocation(url, line, column);
    return this._frameStats[sfId].leaks;
  }

  public getFramesForFile(url: string): IStackFrame[] {
    const fileInfo = this._fileStackFrames[url];
    if (!fileInfo) {
      return [];
    }
    return fileInfo.map((sf) => this._frames[sf]);
  }

  public getTracesForLeak(l: LeakRoot): IStackFrame[][] {
    return l.stacks.map((s) => s.map((sf) => this._frames[sf]));
  }
}