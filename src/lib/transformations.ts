import {parse as parseJavaScript} from 'esprima';
import {replace as rewriteJavaScript} from 'estraverse';
import {generate as generateJavaScript} from 'escodegen';
import {compile} from 'estemplate';
import {BlockStatement, Program, SequenceExpression, BinaryExpression, UnaryExpression, LogicalExpression, VariableDeclarator, ExpressionStatement, CallExpression, AssignmentExpression, Statement, MemberExpression, Identifier, FunctionDeclaration, FunctionExpression} from 'estree';

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
  let injectionIndex = -1;
  if (headPosition) {
    injectionIndex = headPosition.index + headPosition[0].length;
  } else {
    const htmlPosition = htmlRegex.exec(source);
    if (htmlPosition) {
      injectionIndex = htmlPosition.index + htmlPosition[0].length;
    }
  }
  if (injectionIndex !== -1) {
    return source.slice(0, injectionIndex) + injection + source.slice(injectionIndex);
  } else {
    // This might be an HTML fragment, such as an AngularJS template, that lacks a root <html> node.
    return source;
  }
}

const SCOPE_ASSIGNMENT_EXPRESSION_STR = `Object.defineProperty(<%= functionVarName %>, '__scope__', { get: function() { return <%= scopeVarName %>; }, configurable: true });`;
const EXPRESSION_TRANSFORM_TEMPLATE = compile(`(function(){var <%= functionVarName %>=<%= originalFunction %>;${SCOPE_ASSIGNMENT_EXPRESSION_STR}return <%= functionVarName %>;}())`);
function getExpressionTransform(functionVarName: Identifier | MemberExpression, originalFunction: FunctionExpression, scopeVarName: Identifier): CallExpression {
  let fvn: Identifier;
  if (functionVarName.type === "Identifier") {
    fvn = functionVarName;
  } else {
    // MemberExpression -- it was rewritten to be a scope variable.
    const p = functionVarName.property;
    if (p.type === "Identifier") {
      fvn = p;
    } else {
      fvn = {
        type: "Identifier",
        name: "__anonymous_function__"
      };
    }
  }
  const prog = EXPRESSION_TRANSFORM_TEMPLATE({
    functionVarName: fvn,
    originalFunction,
    scopeVarName
  });
  const rv = <CallExpression> (<ExpressionStatement> prog.body[0]).expression;
  rv.loc = originalFunction.loc;
  return rv;
}

const SCOPE_ASSIGNMENT_TEMPLATE = compile(SCOPE_ASSIGNMENT_EXPRESSION_STR);
function getScopeAssignment(functionVarName: Identifier, scopeVarName: Identifier): ExpressionStatement {
  const prog = SCOPE_ASSIGNMENT_TEMPLATE({
    functionVarName,
    scopeVarName
  });
  return <ExpressionStatement> prog.body[0];
}

function getScopeDefinition(fcn: FunctionDeclaration | FunctionExpression, scope: Scope): Statement[] {
  if (!scope.closedOver) {
    throw new Error(`Cannot produce scope definition for non closed over scope.`);
  }
  const movedIdentifiers = scope.getMovedIdentifiers();
  const unmovedIdentifiers = scope.getUnmovedIdentifiers();
  const parentScopeName = scope.parent.scopeIdentifier;
  const params = fcn.params.map((p) => p.type === "Identifier" ? p.name : null).filter((p) => p !== null);
  const js = `var ${scope.scopeIdentifier} = $$CREATE_SCOPE_OBJECT$$(${parentScopeName},` +
               `${JSON.stringify(movedIdentifiers)},` +
               `{ ${unmovedIdentifiers.map((i) => `${i}: { get: function() { return ${i}; }, set: function(val) { ${i} = val; } }`).join(",")} },` +
               `${JSON.stringify(params)},[${params.join(",")}]);`;
  // $$CREATE_SCOPE_OBJECT$$(parentScopeObject: Scope,
  //    movedVariables: string[],
  //    unmovedVariables: PropertyDescriptorMap,
  //    args: string[],
  //    argValues: any[])
  return <Statement[]> parseJavaScript(js).body;
}

const enum VariableType {
  // Identifier will be moved into scope object.
  MOVED,
  // Identifier will not be moved into scope object.
  UNMOVED,
  // Identifier is an argument. It can be moved, but must be updated
  // to maintain the `arguments` object.
  ARGUMENT,
  UNKNOWN
}

class Scope {
  protected _identifiers = new Map<string, VariableType>();
  public readonly parent: Scope;
  protected _scopeIdentifier: string = null;
  private _closedOver: boolean = true;
  constructor(parent: Scope) {
    this.parent = parent;
  }

  /**
   * Add an identifier to the scope.
   * @param identifier The identifier to add to the scope.
   * @param type If true, the identifier will not be moved into a scope object.
   */
  public add(identifier: string, type: VariableType): void {
    this._identifiers.set(identifier, type);
  }

  /**
   * Get the type of the given identifier.
   * @param identifier
   */
  public getType(identifier: string): VariableType {
    if (this._identifiers.has(identifier)) {
      return this._identifiers.get(identifier);
    } else if (this.parent) {
      return this.parent.getType(identifier);
    } else {
      return VariableType.UNKNOWN;
    }
  }

  /**
   * Get the new location for the given identifier.
   * @param identifier
   */
  public getReplacement(identifier: Identifier): Identifier | MemberExpression {
    if (this._identifiers.has(identifier.name)) {
      if (!this.closedOver) {
        return identifier;
      }
      const unmoved = this._identifiers.get(identifier.name);
      if (unmoved === VariableType.UNMOVED) {
        return identifier;
      } else {
        return {
          type: "MemberExpression",
          computed: false,
          object: {
            type: "Identifier",
            name: this.scopeIdentifier,
            loc: identifier.loc
          },
          property: {
            type: "Identifier",
            name: identifier.name,
            loc: identifier.loc
          },
          loc: identifier.loc
        };
      }
    } else if (this.parent !== null) {
      return this.parent.getReplacement(identifier);
    } else {
      return identifier;
    }
  }

  public getMovedIdentifiers(): string[] {
    const rv = new Array<string>();
    this._identifiers.forEach((type, identifier) => {
      if (type === VariableType.MOVED || type === VariableType.ARGUMENT) {
        rv.push(identifier);
      }
    });
    return rv;
  }

  public getUnmovedIdentifiers(): string[] {
    const rv = new Array<string>();
    this._identifiers.forEach((type, identifier) => {
      if (type === VariableType.UNMOVED) {
        rv.push(identifier);
      }
    });
    return rv;
  }

  public getArguments(): string[] {
    const rv = new Array<string>();
    this._identifiers.forEach((type, identifier) => {
      if (type === VariableType.ARGUMENT) {
        rv.push(identifier);
      }
    });
    return rv;
  }

  public finalize(allIdentifiers: Set<string>): void {
    const base = "scope";
    let varName = base;
    // Randomize
    let count = Math.floor(99999 * Math.random());
    while (allIdentifiers.has(varName)) {
      varName = `${base}${count}`;
      count++;
    }
    this._scopeIdentifier = varName;
    // Add self as unmoved identifier.
    this._identifiers.set(this._scopeIdentifier, VariableType.UNMOVED);
    allIdentifiers.add(this._scopeIdentifier);
  }

  public markAsClosedOver(): void {
    this._closedOver = true;
    if (this.parent !== null) {
      this.parent.markAsClosedOver();
    }
  }

  public get closedOver(): boolean {
    return this._closedOver;
  }

  public get scopeIdentifier(): string {
    if (this._scopeIdentifier === null) {
      throw new Error(`Attempted to get name of non-finalized scope.`);
    }
    return this._scopeIdentifier;
  }
}

class GlobalScope extends Scope {
  private _isNode: boolean;
  constructor(isNode: boolean) {
    super(null);
    this._isNode = isNode;
  }

  public finalize() {
    // NOP.
  }

  public get scopeIdentifier(): string {
    return this._isNode ? "global" : "window";
  }
}

/**
 * Given a JavaScript source file, modifies all function declarations and expressions to expose
 * their closure state on the function object.
 *
 * @param source Source of the JavaScript file.
 */
export function exposeClosureState(filename: string, source: string, isNode: boolean): string {
  let ast = parseJavaScript(source, { loc: true });
  {
    const firstStatement = ast.body[0];
    if (firstStatement && firstStatement.type === "ExpressionStatement") {
      // Esprima feature.
      if ((<any> firstStatement).directive === "no transform") {
        return source;
      }
    }
  }

  let allIdentifiers = new Set<string>();
  let scope: Scope = new GlobalScope(isNode);
  let scopeMap = new Map<Program | FunctionDeclaration | FunctionExpression, Scope>();
  scopeMap.set(ast, scope);

  function enterFunction(fcn: FunctionExpression | FunctionDeclaration) {
    scope.markAsClosedOver();
    scope = new Scope(scope);
    scopeMap.set(fcn, scope);
    fcn.params.forEach((p) => {
      if (p.type === "Identifier") {
        scope.add(p.name, VariableType.ARGUMENT);
      }
    });
  }

  function leaveFunction() {
    scope = scope.parent;
    if (scope === null) {
      throw new Error(`Left too many functions??`);
    }
  }

  function getScope(s: FunctionDeclaration | FunctionExpression): Scope {
    const rv = scopeMap.get(s);
    if (!rv) {
      throw new Error(`No scope map found.`);
    }
    return rv;
  }

  // Pass 1: Build up scope information.
  rewriteJavaScript(ast, {
    enter: function(node, parent) {
      // Workaround for Esprima bug
      // https://github.com/jquery/esprima/issues/1844
      if (node.loc && node.loc.start.column < 0) {
        node.loc.start.column = 0;
      }

      switch(node.type) {
        case 'VariableDeclaration': {
          const decls = node.declarations;
          decls.forEach((d) => {
            const id = d.id;
            if (id.type === "Identifier") {
              scope.add(id.name, VariableType.MOVED);
            }
          });
          break;
        }
        case 'FunctionDeclaration': {
          const name = node.id;
          // Function name
          if (name.type === "Identifier") {
            scope.add(name.name, VariableType.UNMOVED);
          }
          enterFunction(node);
          break;
        }
        case 'FunctionExpression': {
          const name = node.id;
          if (name && name.type === "Identifier") {
            scope.add(name.name, VariableType.UNMOVED);
          }
          enterFunction(node);
          break;
        }
        case 'CatchClause': {
          if (node.param.type === "Identifier") {
            scope.add(node.param.name, VariableType.UNMOVED);
          }
          break;
        }
      }
      return undefined;
    },
    leave: function(node, parent) {
      switch (node.type) {
        case 'FunctionDeclaration':
        case 'FunctionExpression':
          leaveFunction();
          break;
        case "Identifier":
          allIdentifiers.add(node.name);
          break;
        case 'ArrowFunctionExpression':
          throw new Error(`Arrow functions not yet supported.`);
      }
      return undefined;
    }
  });

  //console.log("Scopes decided.");

  // Finalize scopes.
  scopeMap.forEach((s) => s.finalize(allIdentifiers));

  //console.log("Scopes finalized.");

  // Modifications to make to the current block.
  let blockInsertions = new Array<Statement>();
  // Stack of blocks.
  let blocks = new Array<[BlockStatement, Statement[]]>();

  // Pass 2: Insert scope variables.
  const newAst = rewriteJavaScript(ast, {
    enter: function(node, parent) {
      switch(node.type) {
        case 'BlockStatement':
        //console.log("Entering BS");
          blocks.push([node, blockInsertions]);
          blockInsertions = [];
          break;
        case 'FunctionDeclaration':
        case 'FunctionExpression':
          //console.log("Entering function");
          scope = getScope(node);
          break;
      }
      return undefined;
    },
    leave: function(node, parent) {
      function convertDecl(decl: VariableDeclarator): AssignmentExpression {
        if (!decl.init) {
          return <any> decl.id;
        }
        return {
          type: "AssignmentExpression",
          operator: "=",
          left: decl.id,
          right: decl.init,
          loc: decl.loc
        };
      }

      function transform(node: BinaryExpression, op: '===' | '==' | '!==' | '!='): UnaryExpression | CallExpression {
        const strict = op.length === 3;
        const not = op[0] === '!';
        const ce: CallExpression = {
          type: "CallExpression",
          callee: {
            type: "Identifier",
            name: `$$$${strict ? 'S' : ''}EQ$$$`
          },
          arguments: [
            node.left,
            node.right
          ],
          loc: node.loc
        };
        if (not) {
          const ue: UnaryExpression = {
            type: "UnaryExpression",
            operator: "!",
            argument: ce,
            loc: node.loc,
            prefix: true
          };
          return ue;
        } else {
          return ce;
        }
      }

      switch (node.type) {
        case 'Identifier': {
          if (!parent || (parent.type !== "FunctionDeclaration" && parent.type !== "FunctionExpression")) {
            switch (parent.type) {
              case "MemberExpression": {
                // Ignore nested identifiers in member expressions that aren't computed.
                if (node === parent.property && !parent.computed) {
                  return node;
                }
                break;
              }
              case "LabeledStatement":
              case "ContinueStatement":
              case "BreakStatement":
                if (node === parent.label) {
                  return node;
                }
                break;
              case "CatchClause":
                return node;
              case "Property":
                if (parent.key === node) {
                  return node;
                }
                break;
              case "CallExpression":
                if (node === parent.callee) {
                  // Preserve value of 'this' by doing scope.f || scope.f.
                  const le: LogicalExpression = {
                    type: "LogicalExpression",
                    operator: "||",
                    left: scope.getReplacement(node),
                    right: scope.getReplacement(node),
                    loc: node.loc
                  };
                  return le;
                }
                break;
            }
            return scope.getReplacement(node);
          }
          return node;
        }
        case 'AssignmentExpression': {
          // Check if LHS is an argument. It has been rewritten to a member expression
          // if it has.
          const lhs = node.left;
          if (lhs.type === "MemberExpression" && lhs.property.type === "Identifier") {
            const name = lhs.property.name;
            if (scope.getType(name) === VariableType.ARGUMENT) {
              // Rewrite RHS to assign to actual argument variable, too.
              // Works even if RHS is +=, etc.
              return <AssignmentExpression> {
                type: "AssignmentExpression",
                operator: "=",
                left: {
                  type: "Identifier",
                  name: name
                },
                right: node,
                loc: node.loc
              };
            }
          }
          break;
        }
        case 'VariableDeclaration': {
          let statement = true;
          if (parent) {
            switch (parent.type) {
              case 'ForInStatement':
              case 'ForOfStatement':
                // for (var i [in/of] b) {}
                statement = parent.left !== node;
                break;
              case 'ForStatement':
                // for (var i = 3, j = 0; )
                statement = parent.init !== node;
                break;
            }
          }

          if (node.declarations.length === 1) {
            const decl = node.declarations[0];
            if (!decl.init) {
              if (statement) {
                return <ExpressionStatement> {
                  type: "ExpressionStatement",
                  expression: decl.id,
                  loc: node.loc
                };
              } else {
                return decl.id;
              }
            } else {
              const converted = convertDecl(decl);
              if (statement) {
                return <ExpressionStatement> {
                  type: "ExpressionStatement",
                  expression: converted,
                  loc: node.loc
                };
              } else {
                return converted;
              }
            }
          } else {
            const se: SequenceExpression = {
              type: "SequenceExpression",
              expressions: node.declarations.map(convertDecl),
              loc: node.loc
            };
            if (statement) {
              return <ExpressionStatement> {
                type: "ExpressionStatement",
                expression: se,
                loc: node.loc
              };
            } else {
              return se;
            }
          }
        }
        case 'FunctionDeclaration': {
          scope = scope.parent;
          //console.log("Leaving FD");
          blockInsertions = blockInsertions.concat(getScopeAssignment(node.id, {
            type: "Identifier",
            name: scope.scopeIdentifier
          }));
          return node;
        }
        case 'FunctionExpression': {
          scope = scope.parent;
          return getExpressionTransform(node.id || (<any> parent).id || {
            type: "Identifier",
            name: "__anonymous_function__"
          }, node, {
            type: "Identifier",
            name: scope.scopeIdentifier
          });
        }
        // const scopeDef = getScopeDefinition(scope);
        case 'ArrowFunctionExpression':
          throw new Error(`Arrow functions not yet supported.`);
        case 'BlockStatement':
        //console.log("Leaving BS");
          const currentBlockInsertions = blockInsertions;
          const n = blocks.pop();
          blockInsertions = n[1];
          if (n[0] !== node) {
            throw new Error(`Balancing block statement pop does not match expected value.`);
          }
          if (!(scope instanceof GlobalScope)) {
            if (currentBlockInsertions.length > 0) {
              node.body = currentBlockInsertions.concat(node.body);
            }
            if ((parent.type === "FunctionDeclaration" || parent.type === "FunctionExpression") && scope.closedOver) {
              const scopeDefinition = getScopeDefinition(parent, scope);
              if (node.body.length > 0 && node.body[0].type === "ExpressionStatement" && (<any> node.body[0])['directive'] === 'use strict') {
                node.body = node.body.slice(0, 1).concat(scopeDefinition).concat(node.body.slice(1));
              } else {
                node.body = scopeDefinition.concat(node.body);
              }
            }
          }
          return node;
        case "BinaryExpression":
          // Rewrite equality checks to call into runtime library.
          // Facilitates proxy referential transparency.
          // TODO: instanceof?
          switch (node.operator) {
            case '===':
            case '==':
            case '!==':
            case '!=':
              return transform(node, node.operator);
            default:
              break;
          }
          break;
      }
      return undefined;
    }
  });

  const body = (<Program> newAst).body;
  if (scope instanceof GlobalScope) {
    //body.unshift.apply(body, scope.getPrelude());
  } else {
    throw new Error(`Forgot to pop a scope?`);
  }
  if (blockInsertions.length > 0) {
    body.unshift.apply(body, blockInsertions);
  }

  // console.log("Finished second phase.");
  const converted = <{code: string, map: any}> <any> generateJavaScript(newAst, {
    format: {
      compact: false
    },
    sourceMap: filename,
    sourceMapWithCode: true,
    sourceContent: source
  });
  // Embed sourcemap into code.
  const convertedCode = `${converted.code}//# sourceMappingURL=data:application/json;base64,${new Buffer(converted.map.toString(), "utf8").toString("base64")}`;
  return convertedCode;
}