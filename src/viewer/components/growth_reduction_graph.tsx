import * as React from 'react';
import BLeakResults from '../../lib/bleak_results';
import {scaleLinear as d3ScaleLinear, line as d3Line, select as d3Select,
        axisBottom, axisLeft, mean, deviation, max, zip as d3Zip, range as d3Range, min} from 'd3';
import {SnapshotSizeSummary} from '../../common/interfaces';

interface GrowthReductionGraphProps {
  bleakResults: BLeakResults;
}

interface Line {
  name: string;
  value: number[];
  se?: number[];
}

const BYTES_PER_MB = 1024 * 1024;

function countNonNull<T>(count: number, a: T[] | T): number {
  if (Array.isArray(a)) {
    const aCount = a.reduce(countNonNull, 0);
    if (aCount !== a.length) {
      return count;
    } else {
      return count + 1;
    }
  }
  if (a) {
    return count + 1;
  } else {
    return count;
  }
}

export function isRankingEvaluationComplete(results: BLeakResults): boolean {
  const numLeaks = results.rankingEvaluation.leakShare.length;
  try {
    const zeroLeaksFixed = results.rankingEvaluation.leakShare[0];
    const allLeaksFixed = results.rankingEvaluation.leakShare[numLeaks - 1];
    // Make sure all of the data is there!
    if (!zeroLeaksFixed || !allLeaksFixed || zeroLeaksFixed.reduce(countNonNull, 0) < zeroLeaksFixed.length || allLeaksFixed.reduce(countNonNull, 0) < allLeaksFixed.length) {
      return false;
    }
    return true;
  } catch (e) {
    return false;
  }
}

export function averageGrowth(data: SnapshotSizeSummary[][]): { mean: number, se?: number } {
  // HS => Growth
  const growthData = data.map((d, i) => d.slice(1).map((d, j) => (d.totalSize - data[i][j].totalSize) / BYTES_PER_MB));
  // Growth => Avg Growth
  let avgGrowths: number[] = [];
  const iterations = data[0].length;
  for (let i = 0; i < iterations; i++) {
    avgGrowths.push(mean(growthData.map((d) => d[i])));
  }
  const se = deviation(avgGrowths.slice(4)) / Math.sqrt(avgGrowths.length - 4);
  const meanData = mean(avgGrowths.slice(4));
  if (isNaN(se)) {
    return {
      mean: meanData
    };
  }
  return {
    mean: meanData,
    se
  };
}

export function averageGrowthReduction(avgGrowthNoFixed: { mean: number, se?: number}, allFixed: SnapshotSizeSummary[][]): { mean: number, se?: number, percent: number, percentSe?: number } {
  const avgGrowthAllFixed = averageGrowth(allFixed);
  const growthReduction = avgGrowthNoFixed.mean - avgGrowthAllFixed.mean;
  const percent = 100 * (growthReduction / avgGrowthNoFixed.mean);
  if (avgGrowthNoFixed.se !== undefined) {
    const growthReductionSe = Math.sqrt(Math.pow(avgGrowthAllFixed.se, 2) + Math.pow(avgGrowthNoFixed.se, 2));
    const percentSe = 100 * Math.abs((avgGrowthNoFixed.mean - avgGrowthAllFixed.mean) / avgGrowthNoFixed.mean) * Math.sqrt(Math.pow(growthReductionSe / growthReduction, 2) + Math.pow(avgGrowthNoFixed.se / avgGrowthNoFixed.mean, 2));
    return {
      mean: growthReduction,
      se: growthReductionSe,
      percent,
      percentSe
    };
  } else {
    return {
      mean: growthReduction,
      percent
    };
  }
}

// TODO: Support toggling different size stats, not just totalSize.
export default class GrowthReductionGraph extends React.Component<GrowthReductionGraphProps, {}> {
  private _resizeListener = this._updateGraph.bind(this);

  public componentDidMount() {
    this._updateGraph();
    window.addEventListener('resize', this._resizeListener);
  }

  public componentDidUpdate() {
    this._updateGraph();
  }

  public componentWillUnmount() {
    window.removeEventListener('resize', this._resizeListener);
  }

  private _updateGraph() {
    if (!this._hasHeapStats()) {
      return;
    }
    const d3div = this.refs['d3_div'] as HTMLDivElement;
    if (d3div.childNodes && d3div.childNodes.length > 0) {
      const nodes: Node[] = [];
      for (let i = 0; i < d3div.childNodes.length; i++) {
        nodes.push(d3div.childNodes[i]);
      }
      nodes.forEach((n) => d3div.removeChild(n));
    }

    const svg = d3Select(d3div).append<SVGElement>("svg");
    const svgStyle = getComputedStyle(svg.node());
    const margins = {left: 65, right: 20, top: 10, bottom: 35};
    const svgHeight = parseFloat(svgStyle.height);
    const svgWidth = parseFloat(svgStyle.width);
    const radius = 3;
    const tickSize = 6;

    const rankings: ('leakShare' | 'retainedSize' | 'transitiveClosureSize')[] = ['leakShare', 'retainedSize', 'transitiveClosureSize']
    const rankEval = this.props.bleakResults.rankingEvaluation;

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
    const zeroPoint = averageGrowth(zeroPointData);
    const state = {
      leakShare: null as number[],
      retainedSize: null as number[],
      transitiveClosureSize: null as number[]
    };

    const lines = rankings.map((ranking) => {
      const line: Line = {
        name: ranking,
        value: rankEval[ranking].map((d) => (zeroPoint.mean - averageGrowth(d).mean) * 1024)
      };
      if (rankEval[ranking][0].length > 1) {
        line.se = rankEval[ranking].map((d) => (Math.sqrt(Math.pow(zeroPoint.se, 2) + Math.pow(averageGrowth(d).se, 2)) * 1024));
      }
      return line;
    });
    rankings.forEach((ranking) => {
      state[ranking] =  rankEval[ranking].map((d) => zeroPoint.mean - averageGrowth(d).mean * 1024);
    });

    const maxHeapSize = 1.02 * max(lines.map((l) => max(l.value.map((v, i) => v + (l.se ? (1.96 * l.se[i]) : 0)))));
    const minHeapSize = 0.98 * min(lines.map((l) => min(l.value.map((v, i) => v - (l.se ? (1.96 * l.se[i]) : 0)))));

    const plotWidth = svgWidth - margins.left - margins.right;
    const plotHeight = svgHeight - margins.top - margins.bottom;

    const x = d3ScaleLinear()
      .range([0, plotWidth])
      .domain([0, lines[0].value.length - 1]);
    const y = d3ScaleLinear().range([plotHeight, 0])
      .domain([minHeapSize, maxHeapSize]);

    const valueline = d3Line<[number, number, number]>()
      .x(function(d) { return x(d[0]); })
      .y(function(d) { return y(d[1]); });

    const data = lines.map((l): [number, number, number][] =>
      d3Zip(d3Range(0, l.value.length), l.value, l.se ? l.se : d3Range(0, l.value.length)) as [number, number, number][]
    );

    const g = svg.append("g").attr('transform', `translate(${margins.left}, ${margins.top})`);

    const plots = g.selectAll("g.plot")
      .data(data)
      .enter()
      .append('g')
      .attr('class', (d, i) => `plot plot_${i}`);

    const hasError = !!lines[0].se;
    const self = this;
    function drawPointsAndErrorBars(this: Element, d: [number, number, number][], i: number): void {
      // Prevent overlapping points / bars
      const move = i * 5;
      const g = d3Select(this)
        .selectAll('circle')
        .data(d)
        .enter()
        .append('g')
        .attr('class', 'data-point')
        .attr('data-placement', 'left')
        .attr('title', (d) => `${lines[i].name} ${d[0]} Leaks Fixed: ${self._presentStat(d[1], 'KB', hasError ? d[2] : undefined)}`)
        .each((_, __, g) => {
          for (let i = 0; i < g.length; i++) {
            $(g[i]).tooltip();
          }
        });

      g.append('circle')
        .attr('r', radius)
        .attr('cx', (d) => x(d[0]) + move)
        .attr('cy', (d) => y(d[1]));

      if (hasError) {
        // Straight line
        g.append("line")
          .attr("class", "error-line")
          .attr("x1", function(d) {
            return x(d[0]) + move;
          })
          .attr("y1", function(d) {
            return y(d[1] + (1.96 * d[2]));
          })
          .attr("x2", function(d) {
            return x(d[0]) + move;
          })
          .attr("y2", function(d) {
            return y(d[1] - (1.96 * d[2]));
          });

        // Top cap
        g.append("line")
          .attr("class", "error-cap")
          .attr("x1", function(d) {
            return x(d[0]) - 4 + move;
          })
          .attr("y1", function(d) {
            return y(d[1] + (1.96 * d[2]));
          })
          .attr("x2", function(d) {
            return x(d[0]) + 4 + move;
          })
          .attr("y2", function(d) {
            return y(d[1] + (1.96 * d[2]));
          });

        // Bottom cap
        g.append("line")
          .attr("class", "error-cap")
          .attr("x1", function(d) {
            return x(d[0]) - 4 + move;
          })
          .attr("y1", function(d) {
            return y(d[1] - (1.96 * d[2]));
          })
          .attr("x2", function(d) {
            return x(d[0]) + 4 + move;
          })
          .attr("y2", function(d) {
            return y(d[1] - (1.96 * d[2]));
          });
      }
    }

    plots.append('path')
      .attr("class", 'line')
      .attr("d", valueline);

    plots.each(drawPointsAndErrorBars);


    // Add the X Axis
    g.append("g")
      .attr('class', 'xaxis')
      .attr("transform", `translate(0,${plotHeight})`)
      .call(axisBottom(x).tickSizeOuter(tickSize).tickFormat((n) => {
        let val = typeof(n) === 'number' ? n : n.valueOf();
        if (Math.floor(val) !== val) {
          // Drop the tick mark.
          return undefined as any;
        }
        return n;
      }));

    // Add the Y Axis
    g.append("g")
      .attr('class', 'yaxis')
      .call(axisLeft(y).tickSizeOuter(tickSize).tickFormat((n) => `${n} KB`));

    // Add X axis title
    g.append('text')
      .attr('class', 'xtitle')
      .attr('x', plotWidth >> 1)
      .attr('y', 32) // Approximate height of x axis
      .attr('transform', `translate(0, ${plotHeight})`)
      .style('text-anchor', 'middle')
      .text('Top Ranked Leak Roots Fixed');

    // Add Y axis title
    g.append('text')
      .attr('class', 'ytitle')
      .attr('x', -1 * (plotHeight >> 1)) // x and y are flipped because of rotation
      .attr('y', -58) // Approximate width of y-axis
      .attr('transform', 'rotate(-90)')
      .style('text-anchor', 'middle')
      .style('alignment-baseline', 'central')
      .text('Growth Reduction');


    if (lines.length > 1) {
      // Put up a legend
      const legend = g.append('g')
        .attr('class', 'legend')
        .attr('transform', `translate(15, 15)`);

      const rect = legend.append('rect');

      const legendItems = legend.append<SVGGElement>('g')
        .attr('class', 'legend-items');

      const liWithData = legendItems.selectAll('text')
        .data(lines)
        .enter();

      liWithData.append('text')
        .attr('x', '1.3em')
        .attr('y', (l, i) => `${i}em`)
        .text((l) => l.name);

      liWithData.append('line')
        .attr('class', (_, i) => `plot_${i}`)
        .attr('x1', 0)
        .attr('y1', (d, i) => `${i - 0.3}em`)
        .attr('x2', `1em`)
        .attr('y2', (d, i) => `${i - 0.3}em`);

      // x, y, height, width
      const bbox = legendItems.node().getBBox();
      rect.attr('x', bbox.x - 5)
        .attr('y', bbox.y - 5)
        .attr('height', bbox.height + 10)
        .attr('width', bbox.width + 10);

    }
  }

  private _hasHeapStats(): boolean {
    return !!this.props.bleakResults.heapStats && this.props.bleakResults.heapStats.length > 0;
  }

  private _presentStat(stat: number, metric: string, se?: number) {
    return `${stat.toFixed(2)}${metric}${se ? `, 95% CI [${(stat - (1.96 * se)).toFixed(2)}, ${(stat + (1.96 * se)).toFixed(2)}]` : ''}`
  }

  public render() {
    // TODO: Growth reduction.
    return <div>
      {this._hasHeapStats() ?
        <div ref="d3_div" className="heap-growth-graph">
        </div>
      : ''}
    </div>;
  }
}
