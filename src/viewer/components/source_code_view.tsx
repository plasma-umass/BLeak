import * as React from 'react';
import FileList from './file_list/file_list';
import SourceFileManager from '../model/source_file_manager';
import {default as AceEditor, Marker as AceMarker, Annotation as AceAnnotation} from 'react-ace';
import StackTraceManager from '../model/stack_trace_manager';
import BLeakResults from '../../lib/bleak_results';
import {FileLocation} from '../model/interfaces';
import 'brace/mode/javascript';
import 'brace/theme/github';
import 'brace/ext/searchbox';

interface SourceCodeViewProps {
  results: BLeakResults;
  files: SourceFileManager;
  fileLocation: FileLocation;
}

interface SourceCodeViewState {
  // The currently open file in the editor.
  openFile: string;
  stackTraces: StackTraceManager;
  // URL => (line,column)
  fileState: {[url: string]: [number, number]};
}

export default class SourceCodeView extends React.Component<SourceCodeViewProps, SourceCodeViewState> {
  constructor(props: SourceCodeViewProps, context?: any) {
    super(props, context);
    this.state = {
      openFile: this.props.fileLocation.url,
      stackTraces: StackTraceManager.FromBLeakResults(props.results),
      fileState: {}
    };
    this.state.fileState[this.state.openFile] = [props.fileLocation.line, props.fileLocation.column];
  }

  public componentDidMount() {
    this._scrollAceEditor();
  }

  public componentDidUpdate() {
    this._scrollAceEditor();
  }

  private _scrollAceEditor() {
    const editor: AceAjax.Editor = (this.refs.aceEditor as any).editor;
    let editorState = this.state.fileState[this.state.openFile];
    if (!editorState) {
      editorState = [1, 1];
      this.state.fileState[this.state.openFile] = editorState;
    }
    (editor.renderer.scrollCursorIntoView as any)({ row: editorState[0] - 1, column: editorState[1] - 1 }, 0.5);
  }

  public componentWillReceiveProps(props: SourceCodeViewProps) {
    const sf = props.fileLocation;
    this._changeOpenFile(sf.url, true, [sf.line, sf.column]);
  }

  private _changeOpenFile(url: string, fromProps: boolean, position: [number, number] = this.state.fileState[url] ? this.state.fileState[url] : [1, 1]): void {
    if (!fromProps && url === this.state.openFile) {
      return;
    }
    const editor: AceAjax.Editor = (this.refs.aceEditor as any).editor;
    const lastRow = editor.getLastVisibleRow();
    const firstRow = editor.getFirstVisibleRow();
    const middle = Math.floor((lastRow - firstRow) / 2) + firstRow + 1;
    const newFileState: {[url: string]: [number, number]} = Object.assign({}, this.state.fileState);
    newFileState[this.state.openFile] = [middle, 1];
    newFileState[url] = position;
    this.setState({ openFile: url, fileState: newFileState });
  }

  public render() {
    const frames = this.state.stackTraces.getFramesForFile(this.state.openFile);
    const markers = frames.map((f): AceMarker => {
      // Note: Ace uses 0-index rows and cols internally.
      return {
        startRow: f[1] - 1,
        startCol: f[2] - 1,
        endRow: f[1] - 1,
        endCol: Number.POSITIVE_INFINITY,
        className: 'leak_line',
        type: 'sometype'
      };
    });
    const annotations = frames.map((f): AceAnnotation => {
      return {
        row: f[1] - 1,
        column: 0,
        type: 'error',
        text: 'Code on this line is part of a memory leak.'
      };
    });
    return <div className="row">
      <div className="col-lg-3">
        <FileList files={this.props.files} editorFile={this.state.openFile} onFileSelected={(f) => {
          this._changeOpenFile(f.url, false);
        }} />
      </div>
      <div className="col-lg-9">
        <AceEditor
          ref="aceEditor"
          readOnly={true}
          mode="javascript"
          theme="github"
          width="100%"
          highlightActiveLine={false}
          setOptions={ { highlightGutterLine: false, useWorker: false } }
          annotations={annotations}
          markers={markers}
          value={this.props.files.getSourceFile(this.state.openFile).source} />
      </div>
    </div>;
  }
}