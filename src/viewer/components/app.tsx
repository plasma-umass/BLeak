import * as React from 'react';
import BLeakResults from '../../lib/bleak_results';
import {default as HeapGrowthGraph, isRankingEvaluationComplete} from './heap_growth_graph';
import LeakRootsAndStackTraces from './leak_roots_and_stack_traces';
import SourceCodeViewer from './source_code_view';
import SourceFileManager from '../model/source_file_manager';
import Location from '../model/location';
import StackTraceManager from '../model/stack_trace_manager';
import GrowthReductionTable from './growth_reduction_table';
import GrowthReductionGraph from './growth_reduction_graph';

const enum ViewState {
  WAIT_FOR_FILE,
  PROCESSING_FILE,
  DISPLAYING_FILE
}

interface AppState {
  state: ViewState;
  bleakResults: BLeakResults | null;
  stackTraces: StackTraceManager | null;
  sourceFileManager: SourceFileManager | null;
  errorMessage: string | null;
  progress: number;
  progressMessage: string | null;
  selectedLocation: Location | null;
}

export default class App extends React.Component<{}, AppState> {
  constructor(p: {}, c?: any) {
    super(p, c);
    this.state = {
      state: ViewState.WAIT_FOR_FILE,
      bleakResults: null,
      stackTraces: null,
      sourceFileManager: null,
      errorMessage: null,
      progress: -1,
      progressMessage: null,
      selectedLocation: null
    };
  }

  private _onFileSelect() {
    const input = this.refs['file_select'] as HTMLInputElement;
    const files = input.files;
    if (files.length > 0) {
      this.setState({
        state: ViewState.PROCESSING_FILE,
        progress: 10,
        progressMessage: "Reading in file...",
        errorMessage: null
      });
      const file = files[0];
      const reader = new FileReader();
      reader.onload = async (e) => {
        try {
          const bleakResults = BLeakResults.FromJSON(JSON.parse((e.target as FileReader).result as string));
          const sourceFileManager = await SourceFileManager.FromBLeakResults(bleakResults, (completed, total) => {
            const percent = 10 + (completed / total) * 90;
            this.setState({
              progress: percent,
              progressMessage: `${completed} of ${total} source files formatted...`
            });
          });
          const sourceFiles = sourceFileManager.getSourceFiles();
          const stackTraces = StackTraceManager.FromBLeakResults(sourceFileManager, bleakResults);
          this.setState({
            state: ViewState.DISPLAYING_FILE,
            bleakResults,
            sourceFileManager,
            stackTraces,
            selectedLocation: new Location(sourceFiles[0], 1, 1, true)
          });
        } catch (e) {
          this.setState({
            state: ViewState.WAIT_FOR_FILE,
            errorMessage: `${e}`
          });
        }
      };
      reader.readAsText(file);
    } else {
      this.setState({
        state: ViewState.WAIT_FOR_FILE,
        errorMessage: `Please select a file.`
      });
    }
  }

  public componentWillUpdate(nextProps: {}, nextState: AppState): void {
    if (this.refs['file_select']) {
      const fileSelect = this.refs['file_select'] as HTMLInputElement;
      fileSelect.setCustomValidity(nextState.errorMessage);
    }
  }

  public render() {
    const rankEvalComplete = this.state.state === ViewState.DISPLAYING_FILE && isRankingEvaluationComplete(this.state.bleakResults);
    return <div>
      <nav className="navbar navbar-expand-md navbar-dark bg-dark fixed-top">
        <a className="navbar-brand" href="/"><img src="icon.svg" className="icon" /> BLeak Results Viewer</a>
      </nav>

      <main role="main" className="container-fluid">
        {this.state.state === ViewState.WAIT_FOR_FILE || this.state.state === ViewState.PROCESSING_FILE ?
          <div className="jumbotron" key="bleakUpload">
            <h1 className="display-4">Upload Results File</h1>
            <p className="lead">Upload bleak_results.json from a BLeak run to view the results.</p>
            <hr className="my-4" />
            <form className={"needs-validation" + (this.state.errorMessage ? " was-validated" : "")}>
              {this.state.state === ViewState.PROCESSING_FILE ?
                <div className="progress" key="bleakProgress">
                  <div className="progress-bar" role="progressbar" style={{width: `${this.state.progress.toFixed(0)}%` }} aria-valuenow={this.state.progress} aria-valuemin={0} aria-valuemax={100}>{this.state.progressMessage}</div>
                </div> :
                <div key="bleakUploadForm" className="form-group">
                  <input ref="file_select" type="file" className={"form-control form-control-file" + (this.state.errorMessage ? " is-invalid" : "")} id="bleakResultsUpload" accept=".json" />
                  <div className="invalid-feedback">{this.state.errorMessage}</div>
                </div>}
            </form>
            <p className="lead">
              <button type="submit" className="btn btn-primary" disabled={this.state.state === ViewState.PROCESSING_FILE} onClick={this._onFileSelect.bind(this)}>Submit</button>
            </p>
          </div>
        : ''}
        {this.state.state === ViewState.DISPLAYING_FILE ? <div key="bleakResults">
          <div className="row">
            <div className={rankEvalComplete ? "col-sm-7" : "col-sm"}>
              <h3>Live Heap Size</h3>
              <HeapGrowthGraph key="heap_growth" bleakResults={this.state.bleakResults} />
            </div>
            {rankEvalComplete ? <div key="rankingEvalTable" className="col-sm-5">
              <h3>Growth Reduction for Top Leaks Fixed</h3>
              <GrowthReductionGraph bleakResults={this.state.bleakResults} />
              <GrowthReductionTable bleakResults={this.state.bleakResults} />
            </div> : ''}
          </div>
          <div className="row">
            <div className="col-sm-5">
              <h3>Leak Roots and Stack Traces</h3>
              <LeakRootsAndStackTraces key="leak_root_list" onStackFrameSelect={(sf) => {
                this.setState({
                  selectedLocation: sf
                });
              }} bleakResults={this.state.bleakResults} stackTraces={this.state.stackTraces} selectedLocation={this.state.selectedLocation} />
            </div>
            <div className="col-sm-7">
              <h3>Source Code</h3>
              {this.state.sourceFileManager.getSourceFiles().length === 0 ? <p key="no_source_files">No source files found in results file.</p> :  <SourceCodeViewer key="source_code_viewer" files={this.state.sourceFileManager} stackTraces={this.state.stackTraces} location={this.state.selectedLocation} /> }
            </div>
          </div>
        </div> : ''}
      </main>
    </div>;
  }
}
