import * as React from 'react';
import BLeakResults from '../../lib/bleak_results';
import {scaleLinear as d3ScaleLinear, line as d3Line, select as d3Select,
        axisBottom, axisLeft} from 'd3';

interface HeapGrowthGraphProps {
  bleakResults: BLeakResults;
}

// TODO: Support toggling different size stats, not just totalSize.
export default class HeapGrowthGraph extends React.Component<HeapGrowthGraphProps, {}> {
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
    const heapStats = this.props.bleakResults.heapStats;
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
    const margins = {left: 55, right: 20, top: 10, bottom: 35};
    const g = svg.append("g").attr('transform', `translate(${margins.left}, ${margins.top})`);
    const svgHeight = parseFloat(svgStyle.height);
    const svgWidth = parseFloat(svgStyle.width);
    const radius = 3;
    const tickSize = 6;

    const totalSizes = heapStats.map((h) => h.totalSize / (1024 * 1024));

    const maxHeapSize = Math.max(...totalSizes);
    const minHeapSize = Math.min(...totalSizes);

    const plotWidth = svgWidth - margins.left - margins.right;
    const plotHeight = svgHeight - margins.top - margins.bottom;

    const x = d3ScaleLinear()
      .range([0, plotWidth])
      .domain([0, heapStats.length - 1]);
    const y = d3ScaleLinear().range([plotHeight, 0])
      .domain([minHeapSize, maxHeapSize]);

    const valueline = d3Line()
      .x(function(d) { return x(d[0]); })
      .y(function(d) { return y(d[1]); });

    const data = totalSizes.map((t, i) => [i, t] as [number, number]);

    g.append("path")
      .data([data])
      .attr("class", "line")
      .attr("d", valueline);

    g.selectAll('circle')
      .data(data)
      .enter()
      .append('circle')
      .attr('r', radius)
      .attr('cx', (d) => x(d[0]))
      .attr('cy', (d) => y(d[1]))
      .attr('data-placement', 'left')
      .attr('title', (d) => `Iteration ${d[0]}: ${d[1].toFixed(2)} MB`)
      .each((_, __, g) => {
        for (let i = 0; i < g.length; i++) {
          $(g[i]).tooltip();
        }
      });

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
      .call(axisLeft(y).tickSizeOuter(tickSize).tickFormat((n) => `${n} MB`));

    // Add X axis title
    g.append('text')
      .attr('class', 'xtitle')
      .attr('x', plotWidth >> 1)
      .attr('y', 32) // Approximate height of x axis
      .attr('transform', `translate(0, ${plotHeight})`)
      .style('text-anchor', 'middle')
      .text('Round Trips Completed');

    // Add Y axis title
    g.append('text')
      .attr('class', 'ytitle')
      .attr('x', -1 * (plotHeight >> 1)) // x and y are flipped because of rotation
      .attr('y', -50) // Approximate width of y-axis
      .attr('transform', 'rotate(-90)')
      .style('text-anchor', 'middle')
      .style('alignment-baseline', 'central')
      .text('Live Heap Size');

  }

  private _hasHeapStats(): boolean {
    return !!this.props.bleakResults.heapStats && this.props.bleakResults.heapStats.length > 0;
  }

  public render() {
    let avgGrowth = 0;
    let samples = 0;
    if (this._hasHeapStats()) {
      const heapStats = this.props.bleakResults.heapStats;
      if (heapStats.length > 5) {
        const postSteadyState = heapStats.slice(Math.floor(5));
        avgGrowth = postSteadyState.reduce((prev, curr, i) => {
          if (i === 0) {
            return prev;
          } else {
            const prevElement = postSteadyState[i - 1];
            return prev + (curr.totalSize - prevElement.totalSize);
          }
        }, 0) / (postSteadyState.length - 1) / (1024 * 1024);
        samples = postSteadyState.length;
      }
    }
    return <div>
      <div className={this._hasHeapStats() && samples > 0 ? '' : 'hidden'}>
        <b>Average Growth:</b> {avgGrowth.toFixed(2)} MB / round trip <br />
        (Ignores impact of first 5 heap snapshots, which are typically noisy due to applicaton startup + JavaScript engine warmup)
      </div>
      <div ref="d3_div" className="heap-growth-graph">
        <div className={this._hasHeapStats() ? 'hidden' : ''}>
          Results file does not contain any heap growth information. Please re-run in the newest version of BLeak.
        </div>
      </div>
    </div>;
  }
}