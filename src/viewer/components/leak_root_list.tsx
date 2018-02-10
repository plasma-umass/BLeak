import * as React from 'react';
import BLeakResults from '../../lib/bleak_results';
import LeakRoot from '../../lib/leak_root';
import LeakRootComponent from './leak_root';
import {IStackFrame} from '../../common/interfaces';
import {FileLocation} from '../model/interfaces';

interface LeakRootListProps {
  bleakResults: BLeakResults;
  rankBy: "transitiveClosureSize" | "leakShare" | "retainedSize" | "ownedObjects";
  onStackFrameSelect: (sf: IStackFrame) => void;
  fileLocation: FileLocation;
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
      {lrs.map((lr, rank) => <LeakRootComponent fileLocation={this.props.fileLocation} onStackFrameSelect={this.props.onStackFrameSelect} key={`leakroot${this.props.rankBy}${rank}`} rank={rank} rankBy={this.props.rankBy} bleakResults={this.props.bleakResults} leakRoot={lr} />)}
    </div>;
  }
}
