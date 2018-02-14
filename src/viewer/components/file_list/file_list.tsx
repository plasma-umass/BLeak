import * as React from 'react';
import {default as SourceFileManager} from '../../model/source_file_manager';
import SourceFile from '../../model/source_file';
import FolderNode from './folder_node';
import {default as Folder, FolderType} from './model/folder';

interface FileListProps {
  files: SourceFileManager;
  onFileSelected: (file: SourceFile) => void;
  editorFile: SourceFile;
}

interface FileListState {
  root: Folder;
}

export default class FileList extends React.Component<FileListProps, FileListState> {
  constructor(props: FileListProps, context?: any) {
    super(props, context);
    const files = props.files.getSourceFiles();
    let root = new Folder(FolderType.ROOT, '', '');

    for (const file of files) {
      const url = new URL(file.url);
      let parent = root.getChildFolder(FolderType.ORIGIN, url.origin);
      // N.B.: First string in this slice will be '' for the root directory.
      // We treat origins as root directories.
      const path = url.pathname.split('/').slice(1);
      for (let i = 0; i < path.length; i++) {
        const seg = path[i];
        if (i === path.length - 1) {
          parent.files.push(file);
        } else {
          parent = parent.getChildFolder(FolderType.FOLDER, seg);
        }
      }
    }

    // Compact the tree.
    this.state = {
      root: root.compact()
    };
  }

  public render() {
    const onFileSelected = this.props.onFileSelected;
    const editorFile = this.props.editorFile;
    return <div>
      {this.state.root.folders.map((f, i) =>
        <FolderNode key={`folder${i}`} contents={f} onFileSelected={onFileSelected} editorFile={editorFile} />
      )}
    </div>;
  }
}