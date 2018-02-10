import pathToString from './path_to_string';
import BLeakResults from './bleak_results';
import LeakRoot from './leak_root';

type MetricType = "retainedSize" | "leakShare" | "transitiveClosureSize";

/**
 * Converts a LeakRoot into a subsection of the report.
 * @param l
 * @param metric
 * @param rank
 */
function leakToString(results: BLeakResults, l: LeakRoot, metric: MetricType, rank: number): string {
  const paths = l.paths.map(pathToString);
  return `## LeakRoot Ranked ${rank} [Score: ${l.scores[metric]}]

### GC Paths

* ${paths.join('\n* ')}

### Stack Traces Responsible

${l.stacks.map((stack, i) => {
  return `
${stack.filter((v, i) => i < 10).map((f, j) => {
  const frame = results.stackFrames[f];
  return `        [${j}] ${frame[3]} ${frame[0]}:${frame[1]}:${frame[2]}`;
}).join("\n")}${stack.length > 10 ? `\n        (${stack.length - 10} more...)` : ``}
`;
}).join("\n")}
`;
}

/**
 * Converts a specific sequence of LeakRoots into a section of the report.
 * @param results
 * @param leaksInOrder
 * @param metric
 */
function leaksToString(results: BLeakResults, leaksInOrder: LeakRoot[], metric: MetricType): string {
  return leaksInOrder.map((l, i) => leakToString(results, l, metric, i + 1)).join("\n");
}

/**
 * Given a set of BLeak results, prints a human-readable text report.
 * @param results
 */
export default function TextReporter(results: BLeakResults): string {
  const leaks = results.leaks;
  if (leaks.length === 0) {
    return "No leaks found.";
  }
  const metrics: [string, MetricType][] = [["LeakShare", "leakShare"], ["Retained Size", "retainedSize"], ["Transitive Closure Size", "transitiveClosureSize"]];
  return metrics.map((m) => {
    return `# LeakRoots Ranked By ${m[0]}\n${leaksToString(results, results.leaks.sort((a, b) => b.scores[m[1]] - a.scores[m[1]]), m[1])}\n\n`;
  }).join("\n");
}