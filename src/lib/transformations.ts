import {parse as parseJavaScript} from 'esprima';
import {replace as rewriteJavaScript} from 'estraverse';
import {generate as generateJavaScript} from 'escodegen';
import {compile} from 'estemplate';
import {Node, BlockStatement, Program, ExpressionStatement, SourceLocation} from 'estree';

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
 * @todo Can I turn this into a template?
 */
function getClosureAssignment(functionVarName: string, loc: SourceLocation): Node {
  const js = `${functionVarName}.__closure__ = function(name) { "use strict"; return eval(name); };`;
  const rv = parseJavaScript(js);
  rv.loc = loc;
  return rv;
}

/**
 * Given a JavaScript source file, modifies all function declarations and expressions to expose
 * their closure state on the function object.
 *
 * @param source Source of the JavaScript file.
 */
export function exposeClosureState(filename: string, source: string): string {
  let ast = parseJavaScript(source, { loc: true });
  // Modifications to make to the current block.
  let blockInsertions = new Array<Node>();
  // Stack of blocks.
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
          blockInsertions.push(getClosureAssignment(node.id.name, node.loc));
          break;
        }
        case 'FunctionExpression': {
          // Expose closure.
          const rv = <Program> EXPRESSION_TRANSFORM_TEMPLATE({
            originalFunction: node,
            closureAssignment: getClosureAssignment('__tmp__', node.loc)
          });
          const exp = (<ExpressionStatement> rv.body[0]).expression;
          exp.loc = node.loc;
          return exp;
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
            const rv = <Program> DECLARATION_TRANSFORM_TEMPLATE({
              newBody: currentBlockInsertions.concat(node.body)
            });
            const rvExp = rv.body[0];
            rvExp.loc = node.loc;
            return rvExp;
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
  const converted = <{code: string, map: any}> <any> generateJavaScript(newAst, {
    format: {
      compact: true
    },
    sourceMap: filename,
    sourceMapWithCode: true,
    sourceContent: source
  });
  // Embed sourcemap into code.
  const convertedCode = `${converted.code}//# sourceMappingURL=data:application/json;base64,${new Buffer(converted.map.toString(), "utf8").toString("base64")}`;
  return convertedCode;
}