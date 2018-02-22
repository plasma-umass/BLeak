import * as React from 'react';
import LeakRoot from '../../lib/leak_root';
import pathToString from '../../lib/path_to_string';
import StackTraceComponent from './stack_trace';
import StackFrame from '../model/stack_frame';
import Location from '../model/location';
import StackTraceManager from '../model/stack_trace_manager';

interface LeakRootComponentProps {
  rank: number;
  rankBy: "transitiveClosureSize" | "leakShare" | "retainedSize" | "ownedObjects";
  stackTraces: StackTraceManager;
  leakRoot: LeakRoot;
  onStackFrameSelect: (sf: StackFrame) => void;
  selectedLocation: Location;
}

interface LeakRootComponentState {
  expanded: boolean;
}

export default class LeakRootComponent extends React.Component<LeakRootComponentProps, LeakRootComponentState> {
  constructor(props: LeakRootComponentProps, c: any) {
    super(props, c);
    this.state = { expanded: false };
  }

  public render() {
    const lr = this.props.leakRoot;
    const paths = lr.paths;
    const keyPrefix = `${this.props.rankBy}${this.props.rank}`;
    const extraPathsToDisplay = this.state.expanded ? paths.length - 1 : 5;
    return <div className="card">
      <div className="card-header" id={keyPrefix} key={keyPrefix}>
        <h5 className="mb-0">
          <button className="btn btn-link collapsed" data-toggle="collapse" data-target={`#collapse${keyPrefix}`} aria-expanded="false" aria-controls={`collapse${keyPrefix}`}>
            Score {Math.floor(lr.scores[this.props.rankBy])} {pathToString(paths[0])}
          </button>
        </h5>
      </div>

      <div id={`collapse${keyPrefix}`} className="collapse" aria-labelledby={keyPrefix}>
        <div className="card-body">
          <p className={paths.length > 1 ? "" : "hidden"}>Also accessible via the following paths:</p>
          <ul className={paths.length > 1 ? "" : "hidden"}>
            {paths.slice(1, extraPathsToDisplay + 1).map((p, i) => <li key={`${keyPrefix}Path${i}`}>{pathToString(p)}</li>)}
            <li className={this.state.expanded || paths.length < 7 ? "hidden" : ""}><button className="btn btn-link" style={{padding: 0}} onClick={() => this.setState({expanded: true})}>Show {paths.length - extraPathsToDisplay - 1} more...</button></li>
          </ul>
          <div className="stack-trace-list">
            {lr.stacks.map((s) => this.props.stackTraces.stackToFrames(s)).map((s, i) => {
              const stKeyPrefix = `${keyPrefix}Stack${i}`;
              return <div className="stack-trace" key={stKeyPrefix}>
                <p><b>Stack Trace {i + 1}</b></p>
                <StackTraceComponent keyPrefix={stKeyPrefix} selectedLocation={this.props.selectedLocation} onStackFrameSelect={this.props.onStackFrameSelect} stack={s} />
              </div>;
            })}
          </div>
          <div className={lr.stacks.length == 0 ? "" : "hidden"}>
            <b>No stack traces recorded!</b> This could indicate a bug in BLeak. If your application is publicly available, please file a bug report <a href="https://github.com/plasma-umass/bleak">on GitHub</a> with your configuration file so we can look into the problem.
          </div>
        </div>
      </div>
    </div>;
  }
}
