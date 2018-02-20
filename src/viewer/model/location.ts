import SourceFile from './source_file';

/**
 * Represents a source code location.
 */
export default class Location {
  /**
   * Construct a source code location.
   * @param file The source file.
   * @param line 1-indexed line.
   * @param column 1-indexed column.
   * @param forOriginal If 'true', this location corresponds to a location in the original non-formatted file.
   */
  constructor(
    public readonly file: SourceFile | null,
    // 1-indexed line
    public readonly line: number,
    // 1-indexed column
    public readonly column: number,
    public readonly forOriginal: boolean) {}

  public get url(): string {
    return this.file ? this.file.url : "<anonymous>";
  }

  public get key(): string {
    return `${this.url}:${this.line}:${this.column}:${this.forOriginal}`;
  }

  /**
   * Zero-indexed line.
   */
  public get lineZeroIndexed(): number {
    return this.line - 1;
  }

  /**
   * Zero-indexed column.
   */
  public get columnZeroIndexed(): number {
    return this.column - 1;
  }

  /**
   * Get the corresponding location for the formatted
   * file. NOP if this is a location for the formatted
   * file.
   */
  public getFormattedLocation(): Location {
    if (!this.forOriginal) {
      return this;
    }
    return this.file.mapping.originalToFormatted(this);
  }

  /**
   * Get the corresponding location for the original
   * file. NOP if this is a location for the original
   * file.
   */
  public getOriginalLocation(): Location {
    if (this.forOriginal || !this.file) {
      return this;
    }
    return this.file.mapping.formattedToOriginal(this);
  }

  /**
   * Returns true if the given locations are equivalent.
   * @param location
   */
  public equal(location: Location): boolean {
    if (this.forOriginal !== location.forOriginal) {
      // Canonicalize.
      return this.getOriginalLocation().equal(location.getOriginalLocation());
    }
    return this.file === location.file && this.line === location.line && this.column === location.column;
  }

  /**
   * Converts into a location for use in the Ace Editor, which has zero-indexed rows and 1-indexed columns.
   */
  public toAceEditorLocation(): { row: number, column: number } {
    return {
      row: this.lineZeroIndexed,
      column: this.column
    };
  }
}