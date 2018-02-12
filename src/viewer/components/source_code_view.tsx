import * as React from 'react';
import FileList from './file_list/file_list';
import SourceFileManager from '../model/source_file_manager';
import {default as AceEditor, Marker as AceMarker, Annotation as AceAnnotation} from 'react-ace';
import StackTraceManager from '../model/stack_trace_manager';
import BLeakResults from '../../lib/bleak_results';
import {FileLocation} from '../model/interfaces';
import {IStackFrame} from '../../common/interfaces';
import pathToString from '../../lib/path_to_string';
import {acequire} from 'brace';
import 'brace/mode/javascript';
import 'brace/theme/github';
import 'brace/ext/searchbox';
const Range = acequire('ace/range').Range;

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
  // Active annotations
  highlightedFrames: IStackFrame[];
}

export default class SourceCodeView extends React.Component<SourceCodeViewProps, SourceCodeViewState> {
  constructor(props: SourceCodeViewProps, context?: any) {
    super(props, context);
    const stm = StackTraceManager.FromBLeakResults(props.results);
    this.state = {
      openFile: this.props.fileLocation.url,
      stackTraces: stm,
      fileState: {},
      highlightedFrames: stm.getFramesForFile(this.props.fileLocation.url)
    };
    this.state.fileState[this.state.openFile] = [props.fileLocation.line, props.fileLocation.column];
  }

  public componentDidMount() {
    this._updateAceEditor();
    // TODO: On click annotation / marker, select frames in left pane.
    /*const editor: AceAjax.Editor = (this.refs.aceEditor as any).editor;
    editor.on('click', (e) => {
      const pos = e.getDocumentPosition();
      const row = pos.row;
      const col = pos.column;
    });*/
    // guttermousedown
  }

  public componentDidUpdate() {
    this._updateAceEditor();
  }

  private _updateAceEditor() {
    const editor: AceAjax.Editor = (this.refs.aceEditor as any).editor;

    // Scroll into view
    let editorState = this.state.fileState[this.state.openFile];
    if (!editorState) {
      editorState = [1, 1];
      this.state.fileState[this.state.openFile] = editorState;
    }
    (editor.renderer.scrollCursorIntoView as any)({ row: editorState[0] - 1, column: editorState[1] - 1 }, 0.5);

    const session = editor.getSession();
    const frames = this.state.highlightedFrames;

    // Display annotations for file.
    const annotations = frames.map((f): AceAnnotation => {
      const leaks = this.state.stackTraces.getLeaksForLocation(f[0], f[1], f[2]);
      return {
        row: f[1] - 1,
        column: f[2] - 1,
        type: 'error',
        text: `Contributes to memory leaks:\n${leaks.map((l) => pathToString(l.paths[0])).join(",\n")}`
      };
    });
    session.setAnnotations(annotations);

    // Remove old markers.
    const markers = session.getMarkers(false);
    for (const prop in markers) {
      if (markers.hasOwnProperty(prop)) {
        session.removeMarker(markers[prop].id);
      }
    }

    const doc = session.getDocument();
    const file = this.props.files.getSourceFile(this.state.openFile);
    const fileSource = file.source;

    // Display markers.
    frames.forEach((f) => {
      const index = doc.positionToIndex({ row: f[1] - 1, column: f[2] - 1 }, 0);
      let parensDeep = 0;
      let inString = false;
      let stringChar: string = null;
      let nextEscaped = false;
      let end = index;
      outerLoop:
      for (end; end < fileSource.length; end++) {
        const c = fileSource[end];
        if (inString) {
          if (nextEscaped) {
            nextEscaped = false;
            continue;
          }
          switch (c) {
            case '\\':
              nextEscaped = true;
            default:
              inString = c === stringChar;
              break;
          }
        } else if (parensDeep > 0) {
          switch(c) {
            case '(':
              parensDeep++;
              break;
            case ')':
              parensDeep--;
              break;
          }
          if (parensDeep === 0) {
            // Break outer loop.
            // We reached the end of a function call.
            break outerLoop;
          }
        } else {
          switch (c) {
            case '"':
            case "'":
              inString = true;
              stringChar = c;
              break;
            case '(':
              parensDeep = 1;
              break;
            case ';':
            case ',':
            case ':':
            case '\n':
              // End of statement.
              break outerLoop;
          }
        }
      }
      const endPos = doc.indexToPosition(end, 0);
      session.addMarker(new Range(f[1] - 1, f[2] - 1, endPos.row, endPos.column), 'leak_line', 'someType', false);
    });
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
    const frames = this.state.stackTraces.getFramesForFile(url);
    this.setState({ openFile: url, fileState: newFileState, highlightedFrames: frames });
  }

  public render() {
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
          value={this.props.files.getSourceFile(this.state.openFile).source} />
      </div>
    </div>;
  }
}