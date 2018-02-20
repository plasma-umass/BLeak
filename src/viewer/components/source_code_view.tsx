import * as React from 'react';
import FileList from './file_list/file_list';
import SourceFileManager from '../model/source_file_manager';
import {default as AceEditor, Annotation as AceAnnotation} from 'react-ace';
import StackTraceManager from '../model/stack_trace_manager';
import SourceFile from '../model/source_file';
import StackFrame from '../model/stack_frame';
import pathToString from '../../lib/path_to_string';
import Location from '../model/location';
import {acequire} from 'brace';
import 'brace/mode/javascript';
import 'brace/theme/github';
import 'brace/ext/searchbox';
const Range = acequire('ace/range').Range;

interface SourceCodeViewProps {
  files: SourceFileManager;
  location: Location;
  stackTraces: StackTraceManager;
}

interface SourceCodeViewState {
  // The currently open file in the editor.
  openFile: SourceFile;
  editorState: Map<SourceFile, EditorFileState>;
  // Active annotations
  highlightedFrames: StackFrame[];
}

class EditorFileState {
  constructor(public location: Location, public prettyPrinted: boolean) {}
}

class CharStream {
  private _source: AceAjax.Document = null;
  private _lineText: string = null;
  private _startLocation: Location = null;
  private _line: number = -1;
  private _column: number = -1;

  public init(source: AceAjax.Document, location: Location): void {
    this._source = source;
    this._startLocation = location;
    this._line = location.lineZeroIndexed;
    this._column = location.columnZeroIndexed;
    this._lineText = source.getLine(this._line);
  }

  public EOF(): boolean {
    return this._line >= this._source.getLength();
  }

  public nextChar(): string {
    this._column++;
    if (this._column >= this._lineText.length) {
      this._line++;
      this._column = 0;
      this._lineText = this._source.getLine(this._line);
    }
    return this._lineText[this._column];
  }

  public toRange(): AceAjax.Range {
    return new Range(this._startLocation.lineZeroIndexed, this._startLocation.column, this._line, this._column + 1);
  }
}

const CHAR_STREAM = new CharStream();

export default class SourceCodeView extends React.Component<SourceCodeViewProps, SourceCodeViewState> {
  constructor(props: SourceCodeViewProps, context?: any) {
    super(props, context);
    this.state = {
      openFile: this.props.location.file,
      editorState: new Map<SourceFile, EditorFileState>(),
      highlightedFrames: this.props.stackTraces.getFramesForFile(this.props.location.file)
    };
    // Initialize editorState for all files.
    this.props.files.getSourceFiles().forEach((f) => {
      const efs = new EditorFileState(new Location(f, 1, 1, true), false);
      this.state.editorState.set(f, efs);
      if (f === this.state.openFile) {
        efs.location = this.props.location;
      }
    });
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
    const editor: AceAjax.Editor = (this.refs.aceEditor as any).editor;
    editor.$blockScrolling = Infinity;
    //
  }

  public componentDidUpdate() {
    this._updateAceEditor();
  }

  private _updateAceEditor() {
    const editor: AceAjax.Editor = (this.refs.aceEditor as any).editor;

    // Scroll into view
    const editorState = this.state.editorState.get(this.state.openFile);
    const prettyPrint = editorState.prettyPrinted;
    const editorStateLocation = prettyPrint ? editorState.location.getFormattedLocation() : editorState.location.getOriginalLocation();
    // Scroll into center of view. (Column is 1-indexed here, row is 0-indexed)
    (editor.renderer.scrollCursorIntoView as any)(editorStateLocation.toAceEditorLocation(), 0.5);

    const session = editor.getSession();
    const frames = this.state.highlightedFrames;

    // Display annotations for file.
    const annotations = frames.map((f): AceAnnotation => {
      const ogLocation = f.getOriginalLocation();
      const location = prettyPrint ? f.getFormattedLocation() : f.getOriginalLocation();
      const leaks = this.props.stackTraces.getLeaksForLocation(ogLocation);
      return Object.assign({
        type: 'error',
        text: `Contributes to memory leaks:\n${leaks.map((l) => pathToString(l.paths[0])).join(",\n")}`
      }, location.toAceEditorLocation());
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

    // Display markers.
    frames.forEach((f) => {
      const location = prettyPrint ? f.getFormattedLocation() : f.getOriginalLocation();
      const displayed = f.equal(editorState.location);
      let parensDeep = 0;
      let inString = false;
      let stringChar: string = null;
      let nextEscaped = false;
      let onlyWhitespace = true;
      CHAR_STREAM.init(doc, location);

      // Hacky heuristic to figure out what to highlight.
      outerLoop:
      while (!CHAR_STREAM.EOF()) {
        const c = CHAR_STREAM.nextChar();
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
              onlyWhitespace = false;
              inString = true;
              stringChar = c;
              break;
            case '(':
              onlyWhitespace = false;
              parensDeep = 1;
              break;
            case ';':
            case ',':
            case ':':
              onlyWhitespace = false;
              // FALL-THRU!
            case '\r':
            case '\n':
              // End of statement.
              if (!onlyWhitespace) {
                break outerLoop;
              }
              break;
          }
        }
      }
      session.addMarker(CHAR_STREAM.toRange(), displayed ? 'leak_line_selected' : 'leak_line', 'someType', false);
    });
  }

  public componentWillReceiveProps(props: SourceCodeViewProps) {
    const loc = props.location;
    this._changeOpenFile(true, loc);
  }

  private _changeOpenFile(fromProps: boolean, location: Location): void {
    if (!fromProps && location.file === this.state.openFile) {
      return;
    }
    const editor: AceAjax.Editor = (this.refs.aceEditor as any).editor;
    const lastRow = editor.getLastVisibleRow();
    const firstRow = editor.getFirstVisibleRow();
    const middle = Math.floor((lastRow - firstRow) / 2) + firstRow + 1;
    const oldFileState = this.state.editorState.get(this.state.openFile);
    oldFileState.location = new Location(this.state.openFile, middle, 1, !oldFileState.prettyPrinted);
    const newFileState = this.state.editorState.get(location.file);
    newFileState.location = location;
    const frames = this.props.stackTraces.getFramesForFile(location.file);
    this.setState({ openFile: location.file, highlightedFrames: frames });
  }

  private _prettyPrintToggle() {
    const fileState = this.state.editorState.get(this.state.openFile);
    fileState.prettyPrinted = !fileState.prettyPrinted;
    this.setState({ editorState: this.state.editorState });
  }

  public render() {
    const sourceFile = this.state.openFile;
    const openFileState = this.state.editorState.get(sourceFile);

    return <div className="row">
      <div className="col-lg-3">
        <FileList files={this.props.files} editorFile={this.state.openFile} onFileSelected={(f) => {
          this._changeOpenFile(false, this.state.editorState.get(f).location);
        }} />
      </div>
      <div className="col-lg-9">
        <div className="row">
          <div className="col-lg-9">
            <p><b>{this.state.openFile.url} {openFileState.prettyPrinted ? '(Pretty Printed)' : ''}</b></p>
          </div>
          <div className="col-lg-3">
            <button type="button" className="btn btn-secondary" onClick={this._prettyPrintToggle.bind(this)}>{openFileState.prettyPrinted ? 'View Original' : 'Pretty Print' }</button>
          </div>
        </div>
        <AceEditor
          ref="aceEditor"
          readOnly={true}
          mode="javascript"
          theme="github"
          width="100%"
          highlightActiveLine={false}
          setOptions={ { highlightGutterLine: false, useWorker: false } }
          value={openFileState.prettyPrinted ? sourceFile.formattedSource : sourceFile.source} />
      </div>
    </div>;
  }
}