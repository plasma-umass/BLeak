import * as React from 'react';
import FileList from './file_list/file_list';
import SourceFileManager from '../model/source_file_manager';
import AceEditor from 'react-ace';
import 'brace/mode/javascript';
import 'brace/theme/github';

interface SourceCodeViewProps {
  files: SourceFileManager;
  openFile: string;
}

interface SourceCodeViewState {
  openFile: string;
}

export default class SourceCodeView extends React.Component<SourceCodeViewProps, SourceCodeViewState> {
  constructor(props: SourceCodeViewProps, context?: any) {
    super(props, context);
    this.state = {
      openFile: this.props.openFile
    };
  }

  public componentWillReceiveProps(props: SourceCodeViewProps) {
    this.setState({ openFile: props.openFile });
  }

  public render() {
    return <div className="row">
      <div className="col-lg-3">
        <FileList files={this.props.files} editorFile={this.state.openFile} onFileSelected={(f) => {
        this.setState({ openFile: f.url });
        }} />
      </div>
      <div className="col-lg-9">
        <AceEditor
          readOnly={true}
          mode="javascript"
          theme="github"
          width="100%"
          highlightActiveLine={false}
          setOptions={ {highlightGutterLine: false, useWorker: false } }
          value={this.props.files.getSourceFile(this.state.openFile).source} />
      </div>
    </div>;
  }
}