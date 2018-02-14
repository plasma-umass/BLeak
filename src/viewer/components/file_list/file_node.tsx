import * as React from 'react';
import SourceFile from '../../model/source_file';

interface FileNodeProps {
  file: SourceFile;
  editorFile: SourceFile;
  onFileSelected: (f: SourceFile) => void;
}

export default class FileNode extends React.Component<FileNodeProps, {}> {
  public render() {
    const file = this.props.file;
    const name = file.url.slice(file.url.lastIndexOf('/') + 1);
    const className = this.props.editorFile === file ? "file selected" : "file";
    return <div className={className} onClick={this.props.onFileSelected.bind(null, file)}>{name}</div>;
  }
}
