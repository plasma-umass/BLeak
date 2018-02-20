import SourceFile from '../../../model/source_file';

export const enum FolderType {
  ORIGIN,
  FOLDER,
  ROOT
}

/**
 * Represents a folder that contains files.
 */
export default class Folder {
  public folders: Folder[] = [];
  public readonly files: SourceFile[] = [];
  private _fullPath: string;
  constructor(public readonly type: FolderType.ORIGIN | FolderType.FOLDER | FolderType.ROOT,
    public parentPath: string,
    public name: string) {
      switch (this.type) {
        case FolderType.ORIGIN:
          this._fullPath = `${this.name}/`;
          break;
        case FolderType.FOLDER:
          this._fullPath = `${parentPath}${name}/`;
          break;
        case FolderType.ROOT:
          this._fullPath = "";
          break;
      }
    }

  /**
   * Gets or creates a new child folder with the given name and type.
   * @param type
   * @param name
   */
  public getChildFolder(type: FolderType.FOLDER | FolderType.ORIGIN, name: string): Folder {
    let rv = this.folders.filter((f) => f.name === name);
    if (rv.length === 0) {
      const folder = new Folder(type, this._fullPath, name);
      this.folders.push(folder);
      return folder;
    }
    return rv[0];
  }

  /**
   * Decides whether or not this node should be inlined into its parents.
   * Happens when it only has one subdirectory and no files.
   */
  public compact(): Folder {
    // Origins and roots don't get compacted.
    if (this.type !== FolderType.FOLDER || this.files.length > 0 || this.folders.length > 1) {
      // Compact children too.
      this.folders = this.folders.map((f) => f.compact());
      return this;
    } else {
      // INVARIANT: *must* have one folder.
      const folder = this.folders[0];
      // Change name to represent this folder too.
      folder.name = `${this.name}/${folder.name}`;
      folder.parentPath = this.parentPath;
      return folder.compact();
    }
  }

  /**
   * Returns true if this folder contains the given file.
   * @param file
   */
  public hasFile(file: SourceFile): boolean {
    const hasFile = this.files.indexOf(file) !== -1;
    if (hasFile) {
      return hasFile;
    }
    for (const folder of this.folders) {
      if (folder.hasFile(file)) {
        return true;
      }
    }
    return false;
  }
}
