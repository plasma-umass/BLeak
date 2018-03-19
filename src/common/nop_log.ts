import {Log, OperationType} from './interfaces';

/**
 * The log that Does Nothing!
 */
export class NopLog implements Log {
  public debug(data: string): void {}
  public log(data: string): void {}
  public error(data: string): void {}
  public timeEvent<T>(operation: OperationType, f: () => T): T {
    return f();
  }
  public getTimeLog(): null { return null; }
}

// We only need a single nop log.
const NOP_LOG = new NopLog();
export default NOP_LOG;
