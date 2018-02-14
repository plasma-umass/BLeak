import Location from './location';
import SourceFile from './source_file';

export default class StackFrame extends Location {
  constructor(file: SourceFile,
    public readonly name: string,
    // 1-indexed line
    line: number,
    // 1-indexed column
    column: number) {
    super(file, line, column, true);
    if (!this.name) {
      this.name = "(anonymous)";
    }
  }
}