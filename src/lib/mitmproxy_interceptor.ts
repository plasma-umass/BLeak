import {parseHTML, exposeClosureState, injectIntoHead, ensureES5} from './transformations';
import {readFileSync} from 'fs';
import {Interceptor, InterceptedHTTPMessage} from 'mitmproxy';
import {Log} from '../common/interfaces';

function identJSTransform(f: string, s: string) {
  return s;
}

function defaultRewrite(url: string, type: string, data: Buffer): Buffer {
  return data;
}

export const DEFAULT_AGENT_PATH = require.resolve('../lib/bleak_agent');
export const DEFAULT_AGENT_URL = `/bleak_agent.js`;
export const DEFAULT_AGENT_TRANSFORM_PATH = require.resolve('../lib/bleak_agent_transform');
export const DEFAULT_AGENT_TRANSFORM_URL = `/bleak_agent_transform.js`;
export const DEFAULT_BABEL_POLYFILL_URL = `/bleak_polyfill.js`;
export const DEFAULT_BABEL_POLYFILL_PATH = require.resolve('babel-polyfill/dist/polyfill');

export interface InterceptorConfig {
  log: Log;
  rewrite: boolean;
  agentUrl?: string;
  agentPath?: string;
  polyfillUrl?: string;
  polyfillPath?: string;
  config: string;
  fixes?: number[];
  disableAllRewrites?: boolean;
  fixRewriteFunction(url: string, type: string, data: Buffer, fixes: number[]): Buffer;
}

const DEFAULT_VALUES = {
  agentPath: DEFAULT_AGENT_PATH,
  agentUrl: DEFAULT_AGENT_URL,
  polyfillUrl: DEFAULT_BABEL_POLYFILL_URL,
  polyfillPath: DEFAULT_BABEL_POLYFILL_PATH,
  config: "",
  fixes: new Array<number>(),
  disableAllRewrites: false,
  fixRewriteFunction: defaultRewrite
};

/**
 * Retrieve a standard BLeak interceptor.
 */
export default function getInterceptor(config: InterceptorConfig): Interceptor {
  config = Object.assign({}, DEFAULT_VALUES, config);
  const agentTransformURL = DEFAULT_AGENT_TRANSFORM_URL;
  const agentTransformPath = DEFAULT_AGENT_TRANSFORM_PATH;
  const parsedInjection = parseHTML(`<script type="text/javascript" src="${config.agentUrl}"></script>
  <script type="text/javascript" src="${agentTransformURL}"></script>
    <script type="text/javascript">
      ${JSON.stringify(config.fixes)}.forEach(function(num) {
        $$$SHOULDFIX$$$(num, true);
      });
      ${config.config}
    </script>
    ${config.disableAllRewrites ? '' : `<script type="text/javascript" src="${config.polyfillUrl}"></script>
    <script type="text/javascript">
      // Babel defines a 'global' variable that trips up some applications' environment detection.
      if (typeof(global) !== "undefined") { delete window['global']; }
    </script>`}`);
  const agentData = readFileSync(config.agentPath);
  const agentTransformData = readFileSync(agentTransformPath);
  const polyfillData = readFileSync(config.polyfillPath);
  return (f: InterceptedHTTPMessage): void => {
    const response = f.response;
    const request = f.request;
    const method = f.request.method;
    const url = request.url;
    // Filter out non 'GET' requests
    if (method !== 'get') {
      if (method === 'post' && url.path === "/eval") {
        // Special eval handler!
        response.statusCode = 200;
        response.clearHeaders();
        const body: { scope: string, source: string } = JSON.parse(f.requestBody.toString());
        if (config.rewrite) {
          f.setResponseBody(Buffer.from(exposeClosureState(`eval-${Math.random()}.js`, body.source, config.agentUrl, config.polyfillUrl, body.scope), 'utf8'));
        } else if (!config.disableAllRewrites) {
          f.setResponseBody(Buffer.from(ensureES5(`eval-${Math.random()}.js`, body.source, config.agentUrl, config.polyfillUrl, body.scope), 'utf8'));
        } else {
          f.setResponseBody(Buffer.from(body.source, 'utf8'));
        }
        response.setHeader('content-type', 'text/javascript');
      }
      return;
    }

    // GET requests
    let mime = response.getHeader('content-type');
    if (mime.indexOf(";") !== -1) {
      mime = mime.slice(0, mime.indexOf(";"));
    }
    // console.log(`[${response.statusCode}] ${request.rawUrl}: ${mime}`);
    // NOTE: Use `pathname`, as it cuts out query variables that may have been tacked on.
    switch (url.pathname.toLowerCase()) {
      case config.agentUrl:
        response.statusCode = 200;
        response.clearHeaders();
        f.setResponseBody(agentData);
        response.setHeader('content-type', 'text/javascript');
        return;
      case agentTransformURL:
        response.statusCode = 200;
        response.clearHeaders();
        if (config.rewrite) {
          f.setResponseBody(Buffer.from(exposeClosureState(url.pathname, agentTransformData.toString("utf8"), config.agentUrl, config.polyfillUrl), 'utf8'));
        } else {
          f.setResponseBody(agentTransformData);
        }
        response.setHeader('content-type', 'text/javascript');
        return;
      case config.polyfillUrl:
        response.statusCode = 200;
        response.clearHeaders();
        f.setResponseBody(polyfillData);
        response.setHeader('content-type', 'text/javascript');
        return;
    }

    if (response.statusCode === 200) {
      // Rewrite before anything else happens.
      f.setResponseBody(config.fixRewriteFunction(request.rawUrl, mime, f.responseBody, config.fixes));
    }

    switch (mime) {
      case 'text/html':
      //if (f.status === 200) {
        f.setResponseBody(Buffer.from(injectIntoHead(url.pathname, f.responseBody.toString("utf8"), parsedInjection, config.rewrite ? exposeClosureState : identJSTransform), 'utf8'));
        //}
        break;
      case 'text/javascript':
      case 'application/javascript':
      case 'text/x-javascript':
      case 'application/x-javascript':
        if (response.statusCode === 200) {
          if (config.rewrite) {
            config.log.debug(`Rewriting ${request.rawUrl}...`);
            f.setResponseBody(Buffer.from(exposeClosureState(url.pathname, f.responseBody.toString("utf8"), config.agentUrl, config.polyfillUrl), 'utf8'));
          } else if (!config.disableAllRewrites) {
            config.log.debug(`ES5ing ${request.rawUrl}...`)
            f.setResponseBody(Buffer.from(ensureES5(url.pathname, f.responseBody.toString("utf8"), config.agentUrl, config.polyfillUrl), 'utf8'));
          }
        }
        break;
    }
  };
}
