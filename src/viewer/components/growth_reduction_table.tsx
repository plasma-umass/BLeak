import * as React from 'react';
import BLeakResults from '../../lib/bleak_results';
import {averageGrowth} from './heap_growth_graph';

interface GrowthReductionTableProps {
  bleakResults: BLeakResults;
}

interface GrowthReductionTableState {
  leakShare: number[];
  retainedSize: number[];
  transitiveClosureSize: number[];
}

export default class GrowthReductionTable extends React.Component<GrowthReductionTableProps, GrowthReductionTableState> {
  public componentWillMount() {
    const rankEval = this.props.bleakResults.rankingEvaluation;
    const numLeaks = rankEval.leakShare.length;
    const rankings: ('leakShare' | 'retainedSize' | 'transitiveClosureSize')[] = ['leakShare', 'retainedSize', 'transitiveClosureSize']
    const qs = [Math.floor(numLeaks * 0.25), Math.floor(numLeaks * 0.5), Math.floor(numLeaks * 0.75)];
    const state: GrowthReductionTableState = {
      leakShare: null,
      retainedSize: null,
      transitiveClosureSize: null
    };
    // Check if zero point is same or different across rankings.
    // Hack for legacy airbnb data.
    let zeroPointData = rankEval.leakShare[0];
    if (zeroPointData[0][0].totalSize !== rankEval.retainedSize[0][0][0].totalSize) {
      // Different data, so can use.
      zeroPointData = [].concat(rankEval.leakShare[0], rankEval.retainedSize[0], rankEval.transitiveClosureSize[0]);
    }
    const zeroPoint = averageGrowth(zeroPointData).mean;
    rankings.forEach((ranking) => {
      state[ranking] = qs.map((q) => (zeroPoint - averageGrowth(rankEval[ranking][q]).mean) * 1024);
    });
    this.setState(state);
  }
  public render() {
    return <table className="table">
      <thead>
        <tr>
          <th scope="col">Metric</th>
          <th scope="col">25%</th>
          <th scope="col">50%</th>
          <th scope="col">75%</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <th scope="row">LeakShare</th>
          <td>{this.state.leakShare[0].toFixed(2)} KB</td>
          <td>{this.state.leakShare[1].toFixed(2)} KB</td>
          <td>{this.state.leakShare[2].toFixed(2)} KB</td>
        </tr>
        <tr>
          <th scope="row">Retained Size</th>
          <td>{this.state.retainedSize[0].toFixed(2)} KB</td>
          <td>{this.state.retainedSize[1].toFixed(2)} KB</td>
          <td>{this.state.retainedSize[2].toFixed(2)} KB</td>
        </tr>
        <tr>
          <th scope="row">Transitive Closure Size</th>
          <td>{this.state.transitiveClosureSize[0].toFixed(2)} KB</td>
          <td>{this.state.transitiveClosureSize[1].toFixed(2)} KB</td>
          <td>{this.state.transitiveClosureSize[2].toFixed(2)} KB</td>
        </tr>
      </tbody>
    </table>
  }
}
