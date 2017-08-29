import {Parser as HTMLParser, DomHandler, DomUtils} from 'htmlparser2';

export {exposeClosureState} from './closure_state_transform';

declare module "htmlparser2" {
  export const DomHandler: any;
  export const DomUtils: any;
}

export interface HTMLNode {
  type: string;
  name?: string;
  data?: string;
  children?: HTMLNode[];
  attribs?: {[n: string]: string};
}

const HTML_PARSER_OPTS = {lowerCaseTags: false, lowerCaseAttributeNames: false};
export function parseHTML(source: string): HTMLNode[] {
  let rv: HTMLNode[];
  let err: any;
  const dom = new DomHandler((e: any, nodes: HTMLNode[]) => {
    rv = nodes;
    err = e;
  });
  const parser = new HTMLParser(dom, HTML_PARSER_OPTS);
  parser.write(source);
  parser.end();
  if (err) {
    return null;
  }
  return rv;
}

function identJSTransform(f: string, s: string) {
  return s;
}

/**
 * Inject the injection string into the <head> portion of the HTML source.
 *
 * If <head> is missing, attempts to inject after the <html> tag.
 *
 * @param filename Path to the HTML file.
 * @param source Source of an HTML file.
 * @param injection Content to inject into the head.
 */
export function injectIntoHead(filename: string, source: string, injection: HTMLNode[], jsTransform: (filename: string, source: string) => string = identJSTransform): string {
  const parsedHTML = parseHTML(source);
  if (parsedHTML === null) {
    // Parsing failed.
    return source;
  }

  let htmlNode: HTMLNode;
  let headNode: HTMLNode;
  let inlineScripts: HTMLNode[] = [];
  function search(n: HTMLNode) {
    // Traverse children first to avoid mutating state
    // before it is traversed.
    if (n.children) {
      n.children.forEach(search);
    }

    if (n.name) {
      switch (n.name.toLowerCase()) {
        case 'head':
          if (!headNode) {
            headNode = n;
          }
          break;
        case 'html':
          if (!htmlNode) {
            htmlNode = n;
          }
          break;
        case 'script':
          const attribs = Object.keys(n.attribs);
          const attribsLower = attribs.map((s) => s.toLowerCase());
          if (n.attribs && attribsLower.indexOf("src") === -1) {
            const typeIndex = attribsLower.indexOf("type");
            if (typeIndex !== -1) {
              const type = n.attribs[attribs[typeIndex]].toLowerCase();
              switch(type) {
                case 'application/javascript':
                case 'text/javascript':
                case 'text/x-javascript':
                case 'text/x-javascript':
                  break;
                default:
                  // IGNORE non-JS script tags.
                  // These are used for things like templates.
                  return;
              }
            }
            inlineScripts.push(n);
          }
          break;
      }
    }
  }
  parsedHTML.forEach(search);

  if (headNode || htmlNode) {
    const injectionTarget = headNode ? headNode : htmlNode;
    if (!injectionTarget.children) {
      injectionTarget.children = [];
    }
    injectionTarget.children = injection.concat(injectionTarget.children);
  } else {
    // AngularJS??
    return source;
  }
  inlineScripts.forEach((n, i) => {
    if (!n.children || n.children.length !== 1) {
      console.log(`Weird! Found JS node with the following children: ${JSON.stringify(n.children)}`);
    }
    n.children[0].data = jsTransform(`${filename}-inline${i}.js`, n.children[0].data);
  });
  return DomUtils.getOuterHTML(parsedHTML);
}

/*export function proxyRewriteFunction(rewrite: boolean, config = "", fixes: number[] = []): (f: SourceFile) => SourceFile {
  const parsedInjection = parseHTML(`<script type="text/javascript" src="${DEFAULT_AGENT_URL}"></script>
    <script type="text/javascript">
      ${JSON.stringify(fixes)}.forEach(function(num) {
        $$$SHOULDFIX$$$(num, true);
      });
      ${config}
    </script>`);
  const agentData = readFileSync(DEFAULT_AGENT_PATH);
  return (f: SourceFile): SourceFile => {
    let mime = f.mimetype.toLowerCase();
    if (mime.indexOf(";") !== -1) {
      mime = mime.slice(0, mime.indexOf(";"));
    }
    console.log(`[${f.status}] ${f.url}: ${mime}`);
    const url = parseURL(f.url);
    // NOTE: Use `pathname`, as it cuts out query variables that may have been tacked on.
    if (url.pathname.toLowerCase() === DEFAULT_AGENT_URL) {
      f.status = 200;
      f.contents = agentData;
      // Note: mimetype may not be javascript.
      f.mimetype = "text/javascript";
      return f;
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
    /*switch (mime) {
      case 'text/html':
      //if (f.status === 200) {
        f.contents = Buffer.from(injectIntoHead(url.pathname, f.contents.toString("utf8"), parsedInjection, rewrite ? exposeClosureState : identJSTransform), 'utf8');
        //}
      break;
      case 'text/javascript':
      case 'application/javascript':
      case 'text/x-javascript':
      case 'application/x-javascript':
        if (f.status === 200 && rewrite) {
          console.log(`Rewriting ${f.url}...`);
          f.contents = Buffer.from(exposeClosureState(url.pathname, f.contents.toString("utf8"), DEFAULT_AGENT_URL), 'utf8');
        }
        break;
    }
    return f;
  };
}

export function evalRewriteFunction(scope: string, source: string): string {
  return exposeClosureState(`eval-${Math.random()}.js`, source, undefined, scope);
}

export function evalNopFunction(scope: string, source: string): string {
  return source;
}
*/
