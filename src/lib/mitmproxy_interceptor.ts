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

/**
 * Retrieve a standard BLeak interceptor.
 * @param agentUrl
 * @param agentPath
 * @param rewrite
 * @param config
 * @param fixes
 * @param disableAllRewrites
 */
export function getInterceptor(log: Log, agentUrl: string, agentPath: string, polyfillUrl: string, polyfillPath: string, rewrite: boolean, config = "", fixes: number[] = [], disableAllRewrites: boolean, fixRewriteFunction: (url: string, type: string, data: Buffer, fixes: number[]) => Buffer = defaultRewrite): Interceptor {
  const agentTransformURL = `${agentUrl.slice(0, -3)}_transform.js`;
  const agentTransformPath = `${agentPath.slice(0, -3)}_transform.js`;
  const parsedInjection = parseHTML(`<script type="text/javascript" src="${agentUrl}"></script>
  <script type="text/javascript" src="${agentTransformURL}"></script>
    <script type="text/javascript">
      ${JSON.stringify(fixes)}.forEach(function(num) {
        $$$SHOULDFIX$$$(num, true);
      });
      ${config}
    </script>
    ${disableAllRewrites ? '' : `<script type="text/javascript" src="${polyfillUrl}"></script>
    <script type="text/javascript">
      // Babel defines a 'global' variable that trips up some applications' environment detection.
      if (typeof(global) !== "undefined") { delete window['global']; }
    </script>`}`);
  const agentData = readFileSync(agentPath);
  const agentTransformData = readFileSync(agentTransformPath);
  const polyfillData = readFileSync(polyfillPath);
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
        if (rewrite) {
          f.setResponseBody(Buffer.from(exposeClosureState(`eval-${Math.random()}.js`, body.source, agentUrl, polyfillUrl, body.scope), 'utf8'));
        } else if (!disableAllRewrites) {
          f.setResponseBody(Buffer.from(ensureES5(`eval-${Math.random()}.js`, body.source, agentUrl, polyfillUrl, body.scope), 'utf8'));
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
      case agentUrl:
        response.statusCode = 200;
        response.clearHeaders();
        f.setResponseBody(agentData);
        response.setHeader('content-type', 'text/javascript');
        return;
      case agentTransformURL:
        response.statusCode = 200;
        response.clearHeaders();
        if (rewrite) {
          f.setResponseBody(Buffer.from(exposeClosureState(url.pathname, agentTransformData.toString("utf8"), agentUrl, polyfillUrl), 'utf8'));
        } else {
          f.setResponseBody(agentTransformData);
        }
        response.setHeader('content-type', 'text/javascript');
        return;
      case polyfillUrl:
        response.statusCode = 200;
        response.clearHeaders();
        f.setResponseBody(polyfillData);
        response.setHeader('content-type', 'text/javascript');
        return;
    }

    if (response.statusCode === 200) {
      // Rewrite before anything else happens.
      f.setResponseBody(fixRewriteFunction(request.rawUrl, mime, f.responseBody, fixes));
    }
    /*if (url.path.indexOf('libraries') !== -1) {
      // XXXX hot fix for mailpile
      const c = f.contents.toString();
      const magic = "tuples[3-i][2].disable,tuples[0][2].lock";
      const i = c.indexOf(magic);
      console.log(`Found jQuery text at ${i}`);
      const newC = c.slice(0, i) + "tuples[3-i][2].disable,tuples[3-i][3].disable,tuples[ 0 ][ 2 ].lock,tuples[ 0 ][ 3 ].lock" + c.slice(i + magic.length);
      f.contents = Buffer.from(newC, "utf8");
    }*/
    /*if (url.path.indexOf("app.js") !== -1) {
      // XXX hot fix 2 for mailpile
      const c = f.contents.toString();
      const magic = `EventLog.subscribe(".mail_source"`;
      const i = c.indexOf(magic);
      console.log(`Found mailsource line at ${i}`);
      const newC = c.slice(0, i) + `if (!window["$$HAS_SUBSCRIBED$$"]) window["$$HAS_SUBSCRIBED$$"] = true && EventLog.subscribe(".mail_source"` + c.slice(i + magic.length);
      f.contents = Buffer.from(newC, "utf8");
    }*/
    switch (mime) {
      case 'text/html':
      //if (f.status === 200) {
        f.setResponseBody(Buffer.from(injectIntoHead(url.pathname, f.responseBody.toString("utf8"), parsedInjection, rewrite ? exposeClosureState : identJSTransform), 'utf8'));
        //}
      break;
      case 'text/javascript':
      case 'application/javascript':
      case 'text/x-javascript':
      case 'application/x-javascript':
        if (response.statusCode === 200) {
          if (rewrite) {
            log.debug(`Rewriting ${request.rawUrl}...`);
            f.setResponseBody(Buffer.from(exposeClosureState(url.pathname, f.responseBody.toString("utf8"), agentUrl, polyfillUrl), 'utf8'));
          } else if (!disableAllRewrites) {
            log.debug(`ES5ing ${request.rawUrl}...`)
            f.setResponseBody(Buffer.from(ensureES5(url.pathname, f.responseBody.toString("utf8"), agentUrl, polyfillUrl), 'utf8'));
          }
        }
        break;
    }
  };
}