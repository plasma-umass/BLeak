import * as React from 'react';
import BLeakResults from '../../lib/bleak_results';
import LeakRoot from '../../lib/leak_root';
import LeakRootComponent from './leak_root';
import StackFrame from '../model/stack_frame';
import Location from '../model/location';
import StackTraceManager from '../model/stack_trace_manager';

interface LeakRootListProps {
  bleakResults: BLeakResults;
  stackTraces: StackTraceManager;
  rankBy: "transitiveClosureSize" | "leakShare" | "retainedSize" | "ownedObjects";
  onStackFrameSelect: (sf: StackFrame) => void;
  selectedLocation: Location;
}

function getSorter(rankBy: "transitiveClosureSize" | "leakShare" | "retainedSize" | "ownedObjects"): (a: LeakRoot, b: LeakRoot) => number {
  return (a, b) => {
    return b.scores[rankBy] - a.scores[rankBy];
  };
}

export default class LeakRootList extends React.Component<LeakRootListProps, {}> {
  public render() {
    const lrs = this.props.bleakResults.leaks.slice(0).sort(getSorter(this.props.rankBy));
    return <div className="row leak-root-list">
      {lrs.map((lr, rank) => <LeakRootComponent stackTraces={this.props.stackTraces} selectedLocation={this.props.selectedLocation} onStackFrameSelect={this.props.onStackFrameSelect} key={`leakroot${this.props.rankBy}${rank}`} rank={rank} rankBy={this.props.rankBy} leakRoot={lr} />)}
    </div>;
  }
}
