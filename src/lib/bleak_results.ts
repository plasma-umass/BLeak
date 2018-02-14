import {IBLeakResults, ILeakRoot, IStackFrame, IStack, ISourceFileRepository, SnapshotSizeSummary, RankingEvaluation} from '../common/interfaces';
import LeakRoot from './leak_root';
import {StackFrame} from 'error-stack-parser';

function leakRootToJSON(l: LeakRoot): ILeakRoot {
  return l.toJSON();
}

function leakRootFromJSON(l: ILeakRoot): LeakRoot {
  return LeakRoot.FromJSON(l);
}

/**
 * Contains the results from a BLeak run.
 */
export default class BLeakResults implements IBLeakResults {
  /**
   * Deserialize from a JSON object.
   * @param br
   */
  public static FromJSON(br: IBLeakResults): BLeakResults {
    return new BLeakResults(br.leaks.map(leakRootFromJSON), br.stackFrames, br.sourceFiles, br.heapStats, br.rankingEvaluation);
  }

  constructor (public readonly leaks: LeakRoot[] = [],
    public readonly stackFrames: IStackFrame[] = [],
    public readonly sourceFiles: ISourceFileRepository = {},
    public readonly heapStats: SnapshotSizeSummary[] = [],
    public readonly rankingEvaluation: RankingEvaluation = { leakShare: [], transitiveClosureSize: [], retainedSize: [] }) {}

  /**
   * Add the given stack frame to the results, and returns a canonical ID.
   * @param sf
   */
  public addStackFrame(url: string, line: number, col: number, functionName: string, source: string): number {
    const sf: IStackFrame = [url, line, col, functionName, source];
    return this.stackFrames.push(sf) - 1;
  }

  /**
   * Adds a given stack frame expressed as an object to the results, and returns a canonical ID.
   * @param sf
   */
  public addStackFrameFromObject(sf: StackFrame): number {
    return this.addStackFrame(sf.fileName, sf.lineNumber, sf.columnNumber, sf.functionName, sf.source);
  }

  /**
   * Adds the given source file to the results.
   * @param url
   * @param source
   */
  public addSourceFile(url: string, mimeType: "text/javascript" | "text/html", source: string): void {
    this.sourceFiles[url] = {
      mimeType,
      source
    };
  }

  /**
   * Compacts the results into a new BLeakResults object.
   * - Deduplicates stack frames.
   * - Removes any source files for which there are no relevant stack frames.
   */
  public compact(): BLeakResults {
    const newSourceFiles: ISourceFileRepository = {}
    const oldSourceFiles = this.sourceFiles;
    const newStackFrames: IStackFrame[] = [];
    const newLeaks: LeakRoot[] = [];
    const oldLeaks = this.leaks;
    const sfMap = new Map<string, { id: number, sf: IStackFrame }>();
    const oldStackFrames = this.stackFrames;
    function sfKey(sf: IStackFrame): string {
      return sf.join(";");
    }
    for (const sf of oldStackFrames) {
      const key = sfKey(sf);
      if (!sfMap.has(key)) {
        const id = newStackFrames.push(sf) - 1;
        sfMap.set(key, { id, sf });
        newSourceFiles[sf[0]] = oldSourceFiles[sf[0]];
      }
    }
    function sfLookup(oldSfId: number): number {
      const sf = oldStackFrames[oldSfId];
      return sfMap.get(sfKey(sf)).id;
    }
    // This is kinda terrible, but we use a string representation
    // of stacks to compare them. There shouldn't be many dupes,
    // but sometimes there are after we normalize stack frames
    // (removing references to bleak agent).
    function stackToString(s: IStack): string {
      return s.join(",");
    }
    for (const leak of oldLeaks) {
      const oldStacks = leak.stacks;
      const newStacks: IStack[] = [];
      const foundStacks = new Set<string>();
      for (const oldStack of oldStacks) {
        const newStack = oldStack.map(sfLookup);
        const stackStr = stackToString(newStack);
        // Ignore duplicate stacks.
        if (!foundStacks.has(stackStr)) {
          foundStacks.add(stackStr);
          newStacks.push(newStack);
        }
      }
      newLeaks.push(new LeakRoot(leak.id, leak.paths, leak.scores, newStacks));
    }
    return new BLeakResults(newLeaks, newStackFrames, newSourceFiles, this.heapStats);
  }

  /**
   * Convert a stack object into a set of frames.
   * @param st
   */
  public stackToFrames(st: IStack): IStackFrame[] {
    const stackFrames = this.stackFrames;
    function lookup(sfId: number): IStackFrame {
      return stackFrames[sfId];
    }
    return st.map(lookup);
  }

  /**
   * Serialize into a JSON object.
   */
  public toJSON(): IBLeakResults {
    return {
      leaks: this.leaks.map(leakRootToJSON),
      stackFrames: this.stackFrames,
      sourceFiles: this.sourceFiles,
      heapStats: this.heapStats,
      rankingEvaluation: this.rankingEvaluation
    };
  }
}
