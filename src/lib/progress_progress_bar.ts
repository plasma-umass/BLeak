import {IProgressBar} from '../common/interfaces';
import * as ProgressBar from 'progress';

/**
 * A ProgressBar, using the 'progress' npm package.
 */
export default class ProgressProgressBar implements IProgressBar {
  private _bar: ProgressBar = null;
  constructor(private readonly _debug: boolean) {}

  public nextOperation(): void {
    this._bar.tick();
  }
  public finish(): void {
    if (this._bar) {
      this._bar.update(1);
    }
  }
  public abort(): void {
    if (this._bar) {
      this._bar.update(1);
    }
  }
  public updateDescription(desc: string): void {
    if (this._bar) {
      this._bar.render({
        msg: desc
      });
    }
  }
  public setOperationCount(count: number): void {
    this._bar = new ProgressBar('[:bar] :percent [:current/:total] :elapseds (ETA :etas) :msg', {
      complete: '=',
      incomplete: ' ',
      width: 20,
      total: count
    });
  }
  public debug(data: string): void {
    if (this._debug) {
      if (this._bar) {
        this._bar.interrupt(`[DEBUG] ${data}`);
      } else {
        console.debug(data);
      }
    }
  }
  public log(data: string): void {
    if (this._bar) {
      this._bar.interrupt(data);
    } else {
      console.log(data);
    }
  }
  public error(data: string): void {
    if (this._bar) {
      // TODO: Red.
      this._bar.interrupt(data);
    } else {
      console.error(data);
    }
  }
}
