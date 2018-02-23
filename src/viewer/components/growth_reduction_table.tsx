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
    // Hack for legacy airbnb data, which has different data for the "no
    // fixes" run across the three metrics (which we leverage to give us
    // tighter error bars on that number / repro the numbers in the paper).
    //
    // On all data produced by BLeak moving forward, the data for the "no fixes"
    // run is the same / shared across metrics -- so we just use the data reported
    // for one metric as the base case.
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
    const top = [0,1,2].map((i) => Math.max(this.state.leakShare[i], this.state.retainedSize[i], this.state.transitiveClosureSize[i]));
    function withinOnePercent(a: number, b: number): boolean {
      // Handle case where a is negative.
      return (a + Math.abs(0.01 * a)) >= b;
    }
    const state = this.state;
    function cell(metric: 'leakShare' | 'retainedSize' | 'transitiveClosureSize', i: number) {
      return <td style={ withinOnePercent(state[metric][i], top[i]) ? { fontWeight: 'bold' } : {} }>{state[metric][i].toFixed(2)} KB</td>;
    }

    function row(metric: 'leakShare' | 'retainedSize' | 'transitiveClosureSize', title: string) {
      return <tr>
        <th scope="row">{title}</th>
        {cell(metric, 0)}
        {cell(metric, 1)}
        {cell(metric, 2)}
      </tr>;
    }

    return <div><table className="table">
      <thead>
        <tr>
          <th scope="col">Metric</th>
          <th scope="col">25%</th>
          <th scope="col">50%</th>
          <th scope="col">75%</th>
        </tr>
      </thead>
      <tbody>
        {row('leakShare', 'LeakShare')}
        {row('retainedSize', 'Retained Size')}
        {row('transitiveClosureSize', 'Transitive Closure Size')}
      </tbody>
    </table><p><b>Bold</b> indicates greatest reduction (±1%).</p></div>
  }
}
