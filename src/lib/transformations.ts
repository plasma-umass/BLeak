import {parse as parseJavaScript} from 'esprima';
import {replace as rewriteJavaScript} from 'estraverse';
// import {generate as generateJavaScript} from 'escodegen';
import {generate as generateJavaScript} from 'astring';
import {SourceMapGenerator} from 'source-map';
import {BlockStatement, Node, Program, SequenceExpression, VariableDeclaration, Property, Literal, BinaryExpression, UnaryExpression, LogicalExpression, VariableDeclarator, ExpressionStatement, CallExpression, AssignmentExpression, Statement, MemberExpression, Identifier, FunctionDeclaration, FunctionExpression} from 'estree';
import {SourceFile} from '../common/interfaces';
import {parse as parseURL} from 'url';
import {readFileSync, writeFileSync} from 'fs';
import {Parser as HTMLParser, DomHandler, DomUtils} from 'htmlparser2';

declare module "htmlparser2" {
  export const DomHandler: any;
  export const DomUtils: any;
}

let seed = 0x2F6E2B1;
function deterministicRandom(): number {
  // Robert Jenkins’ 32 bit integer hash function
  seed = ((seed + 0x7ED55D16) + (seed << 12))  & 0xFFFFFFFF;
  seed = ((seed ^ 0xC761C23C) ^ (seed >>> 19)) & 0xFFFFFFFF;
  seed = ((seed + 0x165667B1) + (seed << 5))   & 0xFFFFFFFF;
  seed = ((seed + 0xD3A2646C) ^ (seed << 9))   & 0xFFFFFFFF;
  seed = ((seed + 0xFD7046C5) + (seed << 3))   & 0xFFFFFFFF;
  seed = ((seed ^ 0xB55A4F09) ^ (seed >>> 16)) & 0xFFFFFFFF;
  return (seed & 0xFFFFFFF) / 0x10000000;
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

function identJSTransform(f: string, s: string, isNode: boolean) {
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
export function injectIntoHead(filename: string, source: string, injection: HTMLNode[], jsTransform: (filename: string, source: string, isNode: boolean) => string = identJSTransform): string {
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

  if (!headNode && !htmlNode) {
    // Might be an angular template.
    return source;
  } else {
    const injectionTarget = headNode ? headNode : htmlNode;
    if (!injectionTarget.children) {
      injectionTarget.children = [];
    }
    injectionTarget.children = injection.concat(injectionTarget.children);

    inlineScripts.forEach((n, i) => {
      if (!n.children || n.children.length !== 1) {
        console.log(`Weird! Found JS node with the following children: ${JSON.stringify(n.children)}`);
      }
      n.children[0].data = jsTransform(`${filename}-inline${i}.js`, n.children[0].data, false);
    });
    return DomUtils.getOuterHTML(parsedHTML);
  }
}

function prependToBlock(node: BlockStatement, s: Statement[]): void {
  if (node.body.length > 0 && node.body[0].type === "ExpressionStatement" && (<any> node.body[0])['directive'] === 'use strict') {
    node.body = node.body.slice(0, 1).concat(s).concat(node.body.slice(1));
  } else {
    node.body = s.concat(node.body);
  }
}

function getExpressionTransform(scope: Scope, functionVarName: Identifier | MemberExpression, originalFunction: FunctionExpression, scopeVarName: Identifier): CallExpression {
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
  const ce: CallExpression = {
    type: "CallExpression",
    callee: {
      type: "FunctionExpression",
      id: null,
      params: [],
      body: {
        type: "BlockStatement",
        body: [{
          type: "VariableDeclaration",
          declarations: [{
            type: "VariableDeclarator",
            id: {
              type: "Identifier",
              name: fvn.name
            },
            init: originalFunction
          }],
          kind: "var"
        }, getScopeAssignment(fvn, scopeVarName), {
          type: "ReturnStatement",
          argument: {
            type: "Identifier",
            name: fvn.name
          }
        }]
      },
      generator: false,
      expression: false,
      async: false
    },
    arguments: []
  };

  return ce;
}

function getScopeAssignment(functionVarName: Identifier, scopeVarName: Identifier): ExpressionStatement {
  return {
    type: "ExpressionStatement",
    expression: {
      type: "CallExpression",
      callee: {
        type: "MemberExpression",
        computed: false,
        object: {
          type: "Identifier",
          name: "Object"
        },
        property: {
          type: "Identifier",
          name: "defineProperty"
        }
      },
      arguments: [
        {
          type: "Identifier",
          name: functionVarName.name
        }, {
          type: "Literal",
          value: "__scope__",
          raw: "'__scope__'"
        }, {
          type: "ObjectExpression",
          properties: [{
            type: "Property",
            key: {
              type: "Identifier",
              name: "get"
            },
            computed: false,
            value: {
              type: "FunctionExpression",
              id: null,
              params: [],
              body: {
                  type: "BlockStatement",
                  body: [{
                    type: "ReturnStatement",
                    argument: scopeVarName
                }]
              },
              generator: false,
              expression: false,
              async: false
            },
            kind: "init",
            method: false,
            shorthand: false
            }, {
                type: "Property",
                key: {
                    type: "Identifier",
                    name: "configurable"
                },
                computed: false,
                value: {
                    type: "Literal",
                    value: true,
                    raw: "true"
                },
                kind: "init",
                method: false,
                shorthand: false
            }
          ]
        }
      ]
    }
  };
}

function getStringLiteralArray(names: string[]): Literal[] {
  return names.map((n): Literal => {
    return { type: "Literal", value: n, raw: `"${n}"` }
  });
}

function getIdentifierArray(names: string[]): Identifier[] {
  return names.map((n): Identifier => {
    return { type: "Identifier", name: n }
  });
}

function getScopeProperties(names: string[]): Property[] {
  return names.map((n): Property => {
    return {
      type: "Property",
      key: { type: "Identifier", name: n },
      computed: false,
      value: {
        type: "ObjectExpression",
        properties: [{
          type: "Property",
          key: { type: "Identifier", name: "get" },
          computed: false,
          value: {
            type: "FunctionExpression",
            id: null,
            params: [],
            body: {
                type: "BlockStatement",
                body: [{
                  type: "ReturnStatement",
                  argument: {
                      type: "Identifier",
                      name: n
                  }
                }]
            },
            generator: false,
            expression: false,
            async: false
          },
          kind: "init",
          method: false,
          shorthand: false
        }, {
          type: "Property",
          key: { type: "Identifier", name: "set" },
          computed: false,
          value: {
            type: "FunctionExpression",
            id: null,
            params: [{ type: "Identifier", name: "v" }],
            body: {
              type: "BlockStatement",
              body: [{
                type: "ExpressionStatement",
                expression: {
                  type: "AssignmentExpression",
                  operator: "=",
                  left: {
                      type: "Identifier",
                      name: n
                  },
                  right: {
                      type: "Identifier",
                      name: "v"
                  }
                }
              }]
            },
            generator: false,
            expression: false,
            async: false
          },
          kind: "init",
          method: false,
          shorthand: false
        }]
      },
      kind: "init",
      method: false,
      shorthand: false
    };
  });
}

function getScopeCreationStatement(scopeName: string, parentScopeName: string, movedIdentifiers: string[], unmovedIdentifiers: string[], params: string[]): VariableDeclaration {
  return {
    type: "VariableDeclaration",
    declarations: [{
      type: "VariableDeclarator",
      id: { type: "Identifier", name: scopeName },
      init: {
        type: "CallExpression",
        callee: { type: "Identifier", name: "$$$CREATE_SCOPE_OBJECT$$$" },
        arguments: [
          {
            type: "Identifier",
            name: parentScopeName
          }, {
            type: "ArrayExpression",
            elements: getStringLiteralArray(movedIdentifiers)
          }, {
            type: "ObjectExpression",
            properties: getScopeProperties(unmovedIdentifiers)
          }, {
            type: "ArrayExpression",
            elements: getStringLiteralArray(params)
          }, {
            type: "ArrayExpression",
            elements: getIdentifierArray(params)
          }
        ]
      }
    }],
    kind: "var"
  };
}

function getScopeDefinition(fcn: FunctionDeclaration | FunctionExpression, scope: Scope): VariableDeclaration {
  if (!scope.closedOver) {
    throw new Error(`Cannot produce scope definition for non closed over scope.`);
  }
  const movedIdentifiers = scope.getMovedIdentifiers();
  const unmovedIdentifiers = scope.getUnmovedIdentifiers();
  const parentScopeName = scope.parent.scopeIdentifier;
  const params = fcn.params.map((p) => p.type === "Identifier" ? p.name : null).filter((p) => p !== null);
  return getScopeCreationStatement(scope.scopeIdentifier, parentScopeName, movedIdentifiers, unmovedIdentifiers, params);
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
    // Avoid re-adding the same identifier.
    // Causes a problem with named function expressions.
    if (!this._identifiers.has(identifier)) {
      this._identifiers.set(identifier, type);
    }
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
    // Randomize, but keep deterministic.
    let count = Math.floor(99999 * deterministicRandom());
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
  constructor(isNode: boolean) {
    super(null);
    this._scopeIdentifier = isNode ? "global" : "$$$GLOBAL$$$";
  }

  public finalize() {
    // NOP.
  }

  public get scopeIdentifier(): string {
    return this._scopeIdentifier;
  }
}

class EvalScope extends Scope {
  constructor(scopeIdentifier: string) {
    super(null);
    this._scopeIdentifier = scopeIdentifier;
  }

  public finalize() {
    // NOP
  }

  public getReplacement(identifier: Identifier): Identifier | MemberExpression {
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
}

/**
 * Given a JavaScript source file, modifies all function declarations and expressions to expose
 * their closure state on the function object.
 *
 * @param source Source of the JavaScript file.
 */
export function exposeClosureState(filename: string, source: string, isNode: boolean, agentUrl="bleak_agent.js", parentScopeName?: string): string {
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
  let scope: Scope = parentScopeName ? new EvalScope(parentScopeName) : new GlobalScope(isNode);
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

  function enterPass1Function(node: Node, parent: Node): Node | undefined {
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
        if (parent.type !== "BlockStatement" && parent.type !== "Program") {
          // Undefined behavior!!!
          // Turn into a function expression assignment to a var. Chrome seems to treat it as such.
          // Will be re-visited later as a FunctionExpression.
          const rewrite: VariableDeclaration = {
            type: "VariableDeclaration",
            declarations: [
              {
                type: "VariableDeclarator",
                id: {
                  type: "Identifier",
                  name: node.id.name,
                  loc: node.id.loc
                },
                init: {
                  type: "FunctionExpression",
                  // Remove name of function to avoid clashes with
                  // new variable name.
                  id: null,
                  params: node.params,
                  body: node.body,
                  generator: node.generator,
                  expression: (<any>node).expression,
                  async: node.async,
                  loc: node.loc
                },
                loc: node.loc
              }
            ],
            kind: "var",
            loc: node.loc
          };
          // Visit the new variable declaration.
          enterPass1Function(rewrite, parent);
          return rewrite;
        } else {
          // Function name
          if (name.type === "Identifier") {
            scope.add(name.name, VariableType.UNMOVED);
          }
          enterFunction(node);
        }
        break;
      }
      case 'FunctionExpression': {
        const name = node.id;
        enterFunction(node);
        // The identifier *only exists* within the function expression!
        // It cannot be overwritten.
        if (name && name.type === "Identifier") {
          scope.add(name.name, VariableType.UNMOVED);
        }
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
  }

  // Pass 1: Build up scope information.
  rewriteJavaScript(ast, {
    enter: enterPass1Function,
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

  // Modifications to make to the top-level function block.
  let blockInsertions = new Array<Statement>();
  // Stack of blocks.
  let blocks = new Array<[BlockStatement, Statement[]]>();

  // Pass 2: Insert scope variables.
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

  function leaveTransform(node: Node, parent: Node): Node {
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
                if (node.name === "eval") {
                  node.name = "$$$REWRITE_EVAL$$$";
                  parent.arguments.unshift({
                    type: "Identifier",
                    name: scope.scopeIdentifier
                  });
                } else {
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
        const assignment = getScopeAssignment(node.id, {
          type: "Identifier",
          name: scope.scopeIdentifier
        });
        blockInsertions = blockInsertions.concat(assignment);
        return node;
      }
      case 'FunctionExpression': {
        scope = scope.parent;
        return getExpressionTransform(scope, node.id || (<any> parent).id || {
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
            prependToBlock(node, currentBlockInsertions);
          }
          if ((parent.type === "FunctionDeclaration" || parent.type === "FunctionExpression") && scope.closedOver) {
            const scopeDefinition = getScopeDefinition(parent, scope);
            prependToBlock(node, [scopeDefinition]);
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
    leave: leaveTransform
  });

  const body = (<Program> newAst).body;
  if (
    // Eval context: There's a parent scope, not a global scope.
    (scope instanceof GlobalScope && parentScopeName)) {

  }

  if (scope instanceof GlobalScope || scope instanceof EvalScope) {
    //body.unshift.apply(body, scope.getPrelude());
  } else {
    throw new Error(`Forgot to pop a scope?`);
  }
  if (blockInsertions.length > 0) {
    body.unshift.apply(body, blockInsertions);
  }
  // importScripts check!
  body.unshift.apply(body, parseJavaScript(`if (typeof(importScripts) !== "undefined") { importScripts("${agentUrl}"); }`).body);

  // console.log("Finished second phase.");
  const map = new SourceMapGenerator({
    file: filename
  });
  map.setSourceContent(filename, source);
  const converted = generateJavaScript(newAst, {
    sourceMap: map
  });
  // Embed sourcemap into code.
  const convertedCode = `${converted}//# sourceMappingURL=data:application/json;base64,${new Buffer(map.toString(), "utf8").toString("base64")}`;
  return convertedCode;
}

export const DEFAULT_AGENT_LOCATION = require.resolve('./bleak_agent');
export const DEFAULT_AGENT_URL = `/bleak_agent.js`;
export function proxyRewriteFunction(rewrite: boolean, config: string = "", fixes: number[] = [], agentURL = DEFAULT_AGENT_URL, agentLocation = DEFAULT_AGENT_LOCATION): (f: SourceFile) => SourceFile {
  const agentData = readFileSync(agentLocation);
  const parsedInjection = parseHTML(`<script type="text/javascript" src="${agentURL}"></script>
  <script type="text/javascript">
    ${JSON.stringify(fixes)}.forEach(function(num) {
      $$$SHOULDFIX$$$(num, true);
    });
    ${config}
  </script>`);
  return (f: SourceFile): SourceFile => {
    let mime = f.mimetype.toLowerCase();
    if (mime.indexOf(";") !== -1) {
      mime = mime.slice(0, mime.indexOf(";"));
    }
    console.log(`[${f.status}] ${f.url}: ${mime}`);
    const url = parseURL(f.url);
    if (url.path.toLowerCase() === agentURL) {
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
    switch (mime) {
      case 'text/html':
        //if (f.status === 200) {
          f.contents = Buffer.from(injectIntoHead(url.path, f.contents.toString("utf8"), parsedInjection, rewrite ? exposeClosureState : identJSTransform), 'utf8');
        //}
        break;
      case 'text/javascript':
      case 'application/javascript':
      case 'text/x-javascript':
      case 'application/x-javascript':
        if (f.status === 200 && rewrite) {
          console.log(`Rewriting ${f.url}...`);
          f.contents = Buffer.from(exposeClosureState(url.path, f.contents.toString("utf8"), false, agentURL), 'utf8');
        }
        break;
    }
    return f;
  };
}

export function evalRewriteFunction(scope: string, source: string): string {
  return exposeClosureState(`eval-${Math.random()}.js`, source, false, undefined, scope);
}

export function evalNopFunction(scope: string, source: string): string {
  return source;
}
