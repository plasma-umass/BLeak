import {IStackFrame} from '../../common/interfaces';
import BLeakResults from '../../lib/bleak_results';
import LeakRoot from '../../lib/leak_root';
import StackFrame from './stack_frame';
import SourceFileManager from './source_file_manager';
import SourceFile from './source_file';
import Location from './location';

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
  public static FromBLeakResults(sourceFileManager: SourceFileManager, results: BLeakResults): StackTraceManager {
    return new StackTraceManager(sourceFileManager, results.stackFrames, results.leaks);
  }

  private _frameStats: StackFrameStats[];
  private _fileStackFrames = new Map<SourceFile, number[]>();
  private _locationToId = new Map<string, number>();
  private _frames: StackFrame[];
  constructor(
    sfm: SourceFileManager,
    frames: IStackFrame[],
    private _leaks: LeakRoot[]
  ) {
    this._frames = frames.map((f) => new StackFrame(sfm.getSourceFile(f[0]), f[3], f[1], f[2]));
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
          let fileStackFrames = this._fileStackFrames.get(sfObj.file);
          if (!fileStackFrames) {
            fileStackFrames = [];
            this._fileStackFrames.set(sfObj.file, fileStackFrames);
          }
          // TODO: Could use a set, but these arrays are expected to be small.
          if (fileStackFrames.indexOf(sf) === -1) {
            fileStackFrames.push(sf);
          }
          this._locationToId.set(sfObj.key, sf);
        }
      });
    });
  }

  private _getFrameForLocation(location: Location): number {
    return this._locationToId.get(location.key);
  }

  public getLeaksForLocation(location: Location): LeakRoot[] {
    const sfId = this._getFrameForLocation(location.getOriginalLocation());
    return this._frameStats[sfId].leaks;
  }

  public getFramesForFile(file: SourceFile): StackFrame[] {
    const fileInfo = this._fileStackFrames.get(file);
    if (!fileInfo) {
      return [];
    }
    // Filter out locations at invalid locations (0, -1, etc).
    return fileInfo.map((sf) => this._frames[sf]).filter((sf) => sf.line > 0 && sf.column > 0);
  }

  public getTracesForLeak(l: LeakRoot): StackFrame[][] {
    return l.stacks.map((s) => s.map((sf) => this._frames[sf]));
  }

  public stackToFrames(s: number[]): StackFrame[] {
    return s.map((s) => this._frames[s]);
  }
}