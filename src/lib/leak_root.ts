import {ILeakRoot, ILeakScores, IStack, IPath} from '../common/interfaces';

/**
 * Represents a leak root in a BLeak report.
 */
export default class LeakRoot implements ILeakRoot {
  public static FromJSON(lr: ILeakRoot): LeakRoot {
    return new LeakRoot(lr.id, lr.paths, lr.scores, lr.stacks);
  }

  constructor(
    public readonly id: number,
    public readonly paths: IPath[],
    public readonly scores: ILeakScores,
    public readonly stacks: IStack[] = []
  ) {}

  public addStackTrace(st: IStack): void {
    this.stacks.push(st);
  }

  public toJSON(): ILeakRoot {
    return {
      id: this.id,
      paths: this.paths,
      scores: this.scores,
      stacks: this.stacks
    };
  }
}