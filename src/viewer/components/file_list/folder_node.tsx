import * as React from 'react';
import {default as Folder} from './model/folder';
import FileNode from './file_node';
import SourceFile from '../../model/source_file';
import TreeView from 'react-treeview';

interface FolderNodeState {
  expanded: boolean;
}

interface FolderNodeProps {
  contents: Folder;
  onFileSelected: (f: SourceFile) => void;
  editorFile: SourceFile;
}

export default class FolderNode extends React.Component<FolderNodeProps, FolderNodeState> {
  private _onClick: () => void;
  constructor(props: FolderNodeProps, context?: any) {
    super(props, context);
    // Begin unexpanded unless we contain the currently displayed file.
    this.state = {
      expanded: props.contents.hasFile(this.props.editorFile)
    };
    this._onClick = () => {
      // Stay expanded if we contain the currently-displayed file, else update expansion
      // status.
      this.setState({
        expanded: props.contents.hasFile(this.props.editorFile) || !this.state.expanded
      });
    };
  }

  private _updateState(props: FolderNodeProps): void {
    // Stay expanded if expanded, else expand if we contain the currently-displayed file.
    this.setState({
      expanded: this.state.expanded || props.contents.hasFile(props.editorFile)
    });
  }

  public componentWillMount() {
    this._updateState(this.props);
  }

  public componentWillReceiveProps(nextProps: FolderNodeProps) {
    this._updateState(nextProps);
  }

  public render(): JSX.Element {
    const contents = this.props.contents;
    const onFileSelected = this.props.onFileSelected;
    const editorFile = this.props.editorFile;
    const label = <span className="folder" onClick={this._onClick}>{contents.name}</span>;
    return <TreeView nodeLabel={label} onClick={this._onClick} collapsed={!this.state.expanded}>
      {contents.folders.map((f, i) =>
        <FolderNode key={`folder${i}`} contents={f} onFileSelected={onFileSelected} editorFile={editorFile} />
      )}
      {contents.files.map((f, i) =>
        <FileNode key={`file${i}`} file={f} editorFile={editorFile} onFileSelected={onFileSelected} />
      )}
    </TreeView>;
  }
}