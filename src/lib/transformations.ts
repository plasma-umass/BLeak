import {parse as parseJavaScript} from 'esprima';
import {replace as rewriteJavaScript} from 'estraverse';
import {generate as generateJavaScript} from 'escodegen';
import {compile} from 'estemplate';
import {Node, BlockStatement, Program} from 'estree';

const headRegex = /<\s*[hH][eE][aA][dD]\s*>/;
const htmlRegex = /<\s*[hH][tT][mM][lL]\s*>/;

/**
 * Inject the injection string into the <head> portion of the HTML source.
 *
 * If <head> is missing, attempts to inject after the <html> tag.
 *
 * @param source Source of an HTML file.
 * @param injection Content to inject into the head.
 */
export function injectIntoHead(source: string, injection: string): string {
  const headPosition = headRegex.exec(source);
  let injectionIndex = 0;
  if (headPosition) {
    injectionIndex = headPosition.index + headPosition[0].length;
  } else {
    const htmlPosition = htmlRegex.exec(source);
    if (htmlPosition) {
      injectionIndex = htmlPosition.index + htmlPosition[0].length;
    }
  }
  return source.slice(0, injectionIndex) + injection + source.slice(injectionIndex);
}

const EXPRESSION_TRANSFORM_TEMPLATE = compile('(function(){var __tmp__=<%= originalFunction %>;<%= closureAssignment %>;return __tmp__;}())');
const DECLARATION_TRANSFORM_TEMPLATE = compile('{%= newBody %}');

/**
 * Exposes variables in a closure on its function object.
 *
 * @param functionVarName The name of the variable containing the function that needs to be modified.
 * @param closureVars The variables in the closure that need to be exposed.
 */
function getClosureAssignment(functionVarName: string, closureVars: string[]): Node {
  const js = `${functionVarName}.__closure__={${closureVars.map((v, i, arr) => `${v}:function(){return ${v};}`).join(",")}};`;
  return parseJavaScript(js);
}

/**
 * Given a listing of (function source code, variables) pairs, modifies the functions in the
 * source code to expose the named variables on the function object.
 *
 * @param source Source of the JavaScript file.
 * @param modifications Closures to modify to expose state on their function objects.
 */
export function exposeClosureState(source: string, modifications: ClosureModification[]): string {
  let modificationMap: {[i: number]: ClosureModification} = {};
  let noMods = true;
  // Dumb algorithm now, for prototyping. Can make much faster later.
  for (const modification of modifications) {
    const fcnSource = modification.source;
    let index = source.indexOf(fcnSource);
    while (index !== -1) {
      noMods = false;
      modificationMap[index] = modification;
      index = source.indexOf(fcnSource, index + 1);
    }
  }
  if (noMods) {
    return source;
  }
  let ast = parseJavaScript(source, {
    range: true
  });

  // Later: Determine if modification falls within node. Need a tree.

  let blockInsertions = new Array<Node>();
  let blocks = new Array<[BlockStatement, Node[]]>();
  const newAst = rewriteJavaScript(ast, {
    // Maintain stack.
    // If found, modify *nearest parent* or the decl itself.
    enter: function(node, parent) {
      switch(node.type) {
        case 'BlockStatement':
          blocks.push([node, blockInsertions]);
          blockInsertions = [];
          break;
      }
      return undefined;
    },
    leave: function(node, parent) {
      switch (node.type) {
        case 'FunctionDeclaration': {
          if (node.range) {
            const i = node.range[0];
            const mod = modificationMap[i];
            if (mod) {
              blockInsertions.push(getClosureAssignment(node.id.name, mod.variables));
            }
          }
          break;
        }
        case 'FunctionExpression': {
          if (node.range) {
            const i = node.range[0];
            const mod = modificationMap[i];
            if (mod) {
              // Expose closure.
              return EXPRESSION_TRANSFORM_TEMPLATE({
                originalFunction: node,
                closureAssignment: getClosureAssignment('__tmp__', mod.variables)
              });
            }
          }
          break;
        }
        case 'ArrowFunctionExpression':
          throw new Error(`Arrow functions not yet supported.`);
        case 'BlockStatement':
          const currentBlockInsertions = blockInsertions;
          const n = blocks.pop();
          blockInsertions = n[1];
          if (n[0] !== node) {
            throw new Error(`Balancing block statement pop does not match expected value.`);
          }
          if (currentBlockInsertions.length > 0) {
            const rv = DECLARATION_TRANSFORM_TEMPLATE({
              newBody: currentBlockInsertions.concat(node.body)
            });
            return rv;
          }
          break;
      }
      return undefined;
    }
  });

  if (blockInsertions.length > 0) {
    const body = (<Program> newAst).body;
    body.unshift.apply(body, blockInsertions);
  }
  return generateJavaScript(newAst, {
    format: {
      compact: true
    }
  });
}