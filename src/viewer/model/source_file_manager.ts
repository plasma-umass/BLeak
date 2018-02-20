import BLeakResults from '../../lib/bleak_results';
import {default as FormatWorker, FormatterSourceMapping} from './../formatter';
import SourceFile from './source_file';

/**
 * Queriable object that stores source files and source maps.
 */
export default class SourceFileManager {
  /**
   * Constructs a SourceFileManager object from BLeakResults. Eagerly
   * formats the source files, and invokes the progress callback after
   * each finishes.
   * @param results
   * @param progress
   */
  public static async FromBLeakResults(results: BLeakResults, progress: (completed: number, total: number) => void): Promise<SourceFileManager> {
    return new Promise<SourceFileManager>(async (resolve, reject) => {
      const sfm = new SourceFileManager();
      const sourceFiles = Object.keys(results.sourceFiles);
      let completed = 0;
      let total = sourceFiles.length;
      function completedCallback(url: string, source: string, formattedSource: string, mapping: FormatterSourceMapping) {
        completed++;
        sfm.addSourceFile(url, source, formattedSource, mapping);
        progress(completed, total);
        if (completed === total) {
          resolve(sfm);
        }
      }
      // Assumption: We're on a ~2 core machine, so let's work it a bit
      // w/ two parallel format requests.
      const workers = await Promise.all([FormatWorker.Create(), FormatWorker.Create()]);
      for (let i = 0; i < sourceFiles.length; i++) {
        const sourceFile = sourceFiles[i];
        const fileContents = results.sourceFiles[sourceFile];
        workers[i % 2].format(fileContents.source, fileContents.mimeType, completedCallback.bind(null, sourceFile), reject);
      }
      if (total === 0) {
        // No source files.
        resolve(sfm);
      }
    });
  }

  private _sourceFiles: {[url: string]: SourceFile} = Object.create(null);

  public addSourceFile(url: string, source: string, formattedSource: string, mapping: FormatterSourceMapping): void {
    this._sourceFiles[url] = new SourceFile(url, source, formattedSource, mapping);
  }

  public getSourceFiles(): SourceFile[] {
    return Object.keys(this._sourceFiles).map((k) => this._sourceFiles[k]);
  }

  public getSourceFile(url: string): SourceFile {
    return this._sourceFiles[url];
  }
}
