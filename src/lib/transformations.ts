import {Parser as HTMLParser, DomHandler, DomUtils} from 'htmlparser2';

export {exposeClosureState, ensureES5, nopTransform} from './closure_state_transform';

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
