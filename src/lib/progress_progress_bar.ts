import {IProgressBar, OperationType} from '../common/interfaces';
import {default as TimeLog, TimeLogEntry} from '../common/time_log';
import * as ProgressBar from 'progress';

const START_TIME = process.hrtime();
function getTimestamp(): number {
  const [seconds, nanoseconds] = process.hrtime(START_TIME);
  const ms = nanoseconds * 1e-6;
  return seconds * 1000 + ms;
}

/**
 * A ProgressBar, using the 'progress' npm package.
 */
export default class ProgressProgressBar implements IProgressBar {
  private _timeLog: TimeLog = null;
  private _bar: ProgressBar = null;
  constructor(private readonly _debug: boolean, private readonly _time: boolean) {
    if (this._time) {
      this._timeLog = new TimeLog();
    }
  }

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
  public timeEvent<T>(operation: OperationType, f: () => T): T {
    if (!this._time) {
      return f();
    }
    const e = new TimeLogEntry(operation, getTimestamp());
    const rv = f();
    if (rv instanceof Promise) {
      return rv.then((v) => {
        e.end = getTimestamp();
        this._timeLog.addEntry(e);
        return v;
      }) as any;
    } else {
      e.end = getTimestamp();
      this._timeLog.addEntry(e);
    }
    return rv;
  }
  public getTimeLog(): TimeLog {
    return this._timeLog;
  }
}
