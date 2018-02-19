import {IBLeakConfig, StepType, Step} from '../common/interfaces';

const DEFAULT_CONFIG: IBLeakConfig = {
  iterations: 8,
  rankingEvaluationIterations: 10,
  rankingEvaluationRuns: 5,
  url: "http://localhost:8080/",
  fixedLeaks: [],
  fixMap: {},
  login: [],
  setup: [],
  loop: [],
  postCheckSleep: 1000,
  postNextSleep: 0,
  postLoginSleep: 5000,
  timeout: 10 * 60 * 1000, // 10 minutes
  rewrite: (url, type, data, fixes) => data
};
const DEFAULT_CONFIG_STRING = JSON.stringify(DEFAULT_CONFIG);

function getConfigFromSource(configSource: string): IBLeakConfig {
  const m = { exports: {} };
  // CommonJS emulation
  try {
    const exportsObj = new Function('exports', 'module', `${configSource}\nreturn module.exports ? module.exports : exports;`)(m.exports, m);
    return Object.assign({}, DEFAULT_CONFIG, exportsObj);
  } catch (e) {
    throw new Error(`Unable to run configuration file: ${e}`);
  }
}

function checkFunction(prop: string, data: Function): void {
  if (typeof(data) !== 'function') {
    throw new Error(`config.${prop} is not a function!`);
  }
}

function checkStep(type: StepType, i: number, data: Step): void {
  checkFunction(`${type}[${i}].check`, data.check);
  checkFunction(`${type}[${i}].next`, data.next);
}

function checkNumber(prop: string, data: number): void {
  if (typeof(data) !== 'number') {
    throw new Error(`config.${prop} is not a number!`);
  }
}

function checkString(prop: string, data: string): void {
  if (typeof(data) !== 'string') {
    throw new Error(`config.${prop} is not a string!`);
  }
}

export default class BLeakConfig implements IBLeakConfig {
  public static FromSource(configSource: string): BLeakConfig {
    const raw = getConfigFromSource(configSource);
    // Sanity check types.
    checkString('url', raw.url);
    raw.loop.forEach((s, i) => checkStep('loop', i, s));
    checkNumber('iterations', raw.iterations);
    checkNumber('rankingEvaluationIterations', raw.rankingEvaluationIterations);
    checkNumber('rankingEvaluationRuns', raw.rankingEvaluationRuns);
    raw.fixedLeaks.forEach((n, i) => checkNumber(`fixedLeaks[${i}]`, n));
    raw.login.forEach((s, i) => checkStep('login', i, s));
    raw.setup.forEach((s, i) => checkStep('setup', i, s));
    checkNumber('timeout', raw.timeout);
    checkFunction('rewrite', raw.rewrite);
    checkNumber('postCheckSleep', raw.postCheckSleep);
    checkNumber('postNextSleep', raw.postNextSleep);
    checkNumber('postLoginSleep', raw.postLoginSleep);
    return new BLeakConfig(raw, configSource);
  }

  public readonly url: string;
  public readonly loop: Step[];
  public readonly iterations: number;
  public readonly rankingEvaluationIterations: number;
  public readonly rankingEvaluationRuns: number;
  public readonly fixedLeaks: number[];
  public readonly fixMap: {[leakRoot: string]: number};
  public readonly login: Step[];
  public readonly setup: Step[];
  public readonly timeout: number;
  public readonly postCheckSleep: number;
  public readonly postNextSleep: number;
  public readonly postLoginSleep: number;
  public readonly rewrite: (url: string, type: string, source: Buffer, fixes: number[]) => Buffer;

  private constructor(raw: IBLeakConfig, private readonly _configSource: string) {
    this.url = raw.url;
    this.loop = raw.loop;
    this.iterations = raw.iterations;
    this.rankingEvaluationIterations = raw.rankingEvaluationIterations;
    this.rankingEvaluationRuns = raw.rankingEvaluationRuns;
    this.fixedLeaks = raw.fixedLeaks;
    this.fixMap = raw.fixMap;
    this.login = raw.login;
    this.setup = raw.setup;
    this.timeout = raw.timeout;
    this.rewrite = raw.rewrite;
    this.postCheckSleep = raw.postCheckSleep;
    this.postNextSleep = raw.postNextSleep;
    this.postLoginSleep = raw.postLoginSleep;
  }

  public getBrowserInjection(): string {
    // CommonJS emulation
    return `(function() {
  var module = { exports: {} };
  var exports = module.exports;
  ${this._configSource}
  window.BLeakConfig = Object.assign({}, ${DEFAULT_CONFIG_STRING}, module.exports ? module.exports : exports);
})();`;
  }
}
