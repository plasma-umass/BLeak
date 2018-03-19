import {IProgressBar} from '../common/interfaces';
import {NopLog} from '../common/nop_log';

/**
 * A progress bar that does... nothing.
 */
export default class NopProgressBar extends NopLog implements IProgressBar {
  nextOperation(): void {}
  finish(): void {}
  abort(): void {}
  updateDescription(desc: string): void {}
  setOperationCount(count: number): void {}
}
