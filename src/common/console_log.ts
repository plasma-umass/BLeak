import {Log, OperationType} from './interfaces';

// Adapter from Log interface to the console interface.
const ConsoleLog: Log = Object.assign({
  timeEvent: function<T>(op: OperationType, f: () => T): T {
    return f();
  },
  getTimeLog(): null {
    return null;
  }
}, console);

export default ConsoleLog;
