import * as React from 'react';
import BLeakResults from '../../lib/bleak_results';
import LeakRootList from './leak_root_list';
import Location from '../model/location';
import StackFrame from '../model/stack_frame';
import StackTraceManager from '../model/stack_trace_manager';

interface LeakRootsAndStackTracesComponentProps {
  bleakResults: BLeakResults;
  onStackFrameSelect: (sf: StackFrame) => void;
  selectedLocation: Location;
  stackTraces: StackTraceManager;
}

interface LeakRootsAndStackTracesComponentState {
  rankBy: "transitiveClosureSize" | "leakShare" | "retainedSize" | "ownedObjects";
}

export default class LeakRootsAndStackTracesComponent extends React.Component<LeakRootsAndStackTracesComponentProps, LeakRootsAndStackTracesComponentState> {
  constructor(props: LeakRootsAndStackTracesComponentProps, c?: any) {
    super(props, c);
    this.state = {
      rankBy: "leakShare"
    };
  }

  public render() {
    return <div>
      <div className="form-group row">
        <label data-for="staticEmail" className="col-sm-2 col-form-label">Rank By</label>
        <div className="col-sm-10">
          <select className="form-control" onChange={(e) => { this.setState({ rankBy: e.target.options[e.target.options.selectedIndex].value as "leakShare" }) }}>
            <option value="leakShare">LeakShare</option>
            <option value="transitiveClosureSize">Transitive Closure Size</option>
            <option value="retainedSize">Retained Size</option>
            <option value="ownedObjects">Uniquely Owned Objects</option>
          </select>
        </div>
      </div>
      <LeakRootList stackTraces={this.props.stackTraces} selectedLocation={this.props.selectedLocation} bleakResults={this.props.bleakResults} onStackFrameSelect={this.props.onStackFrameSelect} rankBy={this.state.rankBy} />
    </div>;
  }
}