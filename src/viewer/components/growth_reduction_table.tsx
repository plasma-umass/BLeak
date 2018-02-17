import * as React from 'react';
import BLeakResults from '../../lib/bleak_results';
import {averageGrowthReduction, averageGrowth} from './heap_growth_graph';

interface GrowthReductionTableProps {
  bleakResults: BLeakResults;
}

interface GrowthReductionTableState {
  leakShare: number[];
  retainedSize: number[];
  transitiveClosureSize: number[];
}

/**
 * Growth re- duction by metric after  xing quartiles of top ranked leaks.
 */

export default class GrowthReductionTable extends React.Component<GrowthReductionTableProps, GrowthReductionTableState> {
  public componentWillMount() {
    const rankEval = this.props.bleakResults.rankingEvaluation;
    const numLeaks = rankEval.leakShare[0].length;
    const rankings: ('leakShare' | 'retainedSize' | 'transitiveClosureSize')[] = ['leakShare', 'retainedSize', 'transitiveClosureSize']
    const qs = [Math.ceil(numLeaks * 0.25), Math.ceil(numLeaks * 0.5), Math.ceil(numLeaks * 0.75)];
    const state: GrowthReductionTableState = {
      leakShare: null,
      retainedSize: null,
      transitiveClosureSize: null
    };
    const zeroPoint = averageGrowth(rankEval.leakShare[0]).mean;
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