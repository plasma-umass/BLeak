import {OperationType} from './interfaces';

export class TimeLogEntry {
  public end: number = 0;
  constructor(public type: OperationType, public start: number) {}
}

export default class TimeLog {
  private _log: TimeLogEntry[] = [];

  public addEntry(e: TimeLogEntry) {
    this._log.push(e);
  }

  public toJSON(): any {
    return this._log;
  }
}
