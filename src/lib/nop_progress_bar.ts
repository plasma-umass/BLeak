import {IProgressBar} from '../common/interfaces';

/**
 * A progress bar that does... nothing.
 */
export default class NopProgressBar implements IProgressBar {
  nextOperation(): void {}
  finish(): void {}
  abort(): void {}
  updateDescription(desc: string): void {}
  setOperationCount(count: number): void {}
  debug(data: string): void {}
  log(data: string): void {}
  error(data: string): void {}
}