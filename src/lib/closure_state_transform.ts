import {Node, BaseStatement, Statement, Program, EmptyStatement, BlockStatement, ExpressionStatement, IfStatement, LabeledStatement, BreakStatement, ContinueStatement, WithStatement, SwitchStatement, ReturnStatement, ThrowStatement, TryStatement, WhileStatement, DoWhileStatement, ForStatement, ForInStatement, DebuggerStatement, ForOfStatement, FunctionDeclaration, VariableDeclaration, VariableDeclarator, ThisExpression, ArrayExpression, ObjectExpression, Property, FunctionExpression, SequenceExpression, UnaryExpression, BinaryExpression, AssignmentExpression, UpdateExpression, LogicalExpression, ConditionalExpression, NewExpression, CallExpression, MemberExpression, SwitchCase, CatchClause, Identifier, Literal, Super, SpreadElement, ArrowFunctionExpression, YieldExpression, TemplateElement, TemplateLiteral, TaggedTemplateExpression, ObjectPattern, ArrayPattern, RestElement, AssignmentPattern, ClassBody, ClassDeclaration, ClassExpression, MethodDefinition, MetaProperty, ImportDeclaration, ImportDefaultSpecifier, ImportNamespaceSpecifier, ImportSpecifier, ExportAllDeclaration, ExportDefaultDeclaration, ExportNamedDeclaration, ExportSpecifier, AwaitExpression} from 'estree';
import {parse as parseJavaScript} from 'esprima';
import {generate as generateJavaScript} from 'astring';
import {SourceMapGenerator} from 'source-map';

/**
 * Fake AST node that contains multiple statements that must be
 * inlined into a block.
 */
interface MultipleStatements extends BaseStatement {
  type: "MultipleStatements";
  body: Statement[];
}

const enum VarType {
  // function or catchclause argument
  ARG,
  // var declaration
  VAR,
  // const declaration
  CONST,
  // function declaration
  FUNCTION_DECL,
  // let declaration
  LET,
  // Used in queries.
  UNKNOWN
}

function getProgramPrelude(agentUrl: string): IfStatement {
  return {
    type: "IfStatement",
    test: {
      type: "BinaryExpression",
      operator: "===",
      left: {
        type: "UnaryExpression",
        operator: "typeof",
        argument: {
          type: "Identifier",
          name: "$$$CREATE_SCOPE_OBJECT$$$"
        },
        prefix: true
      },
      right: {
        type: "Literal",
        value: "undefined",
        raw: "\"undefined\""
      }
    },
    consequent: {
      type: "BlockStatement",
      body: [{
        type: "IfStatement",
        test: {
          type: "BinaryExpression",
          operator: "!==",
          left: {
            type: "UnaryExpression",
            operator: "typeof",
            argument: {
              type: "Identifier",
              name: "XMLHttpRequest"
            },
            prefix: true
          },
          right: {
            type: "Literal",
            value: "undefined",
            raw: "\"undefined\""
          }
        },
        consequent: {
          type: "BlockStatement",
          body: [{
            type: "VariableDeclaration",
            declarations: [{
              type: "VariableDeclarator",
              id: {
                  type: "Identifier",
                  name: "xhr"
              },
              init: {
                  type: "NewExpression",
                  callee: {
                      type: "Identifier",
                      name: "XMLHttpRequest"
                  },
                  arguments: []
              }
            }],
            kind: "const"
          }, {
            type: "ExpressionStatement",
            expression: {
              type: "CallExpression",
              callee: {
                type: "MemberExpression",
                computed: false,
                object: {
                  type: "Identifier",
                  name: "xhr"
                },
                property: {
                  type: "Identifier",
                  name: "open"
                }
              },
              arguments: [{
                  type: "Literal",
                  value: "GET",
                  raw: "'GET'"
                },
                {
                  type: "Literal",
                  value: agentUrl,
                  raw: JSON.stringify(agentUrl)
                },
                {
                  type: "Literal",
                  value: false,
                  raw: "false"
                }
              ]
            }
          }, {
            type: "ExpressionStatement",
            expression: {
              type: "CallExpression",
              callee: {
                type: "MemberExpression",
                computed: false,
                object: {
                  type: "Identifier",
                  name: "xhr"
                },
                property: {
                  type: "Identifier",
                  name: "send"
                }
              },
              arguments: []
            }
          }, {
            type: "ExpressionStatement",
            expression: {
              type: "CallExpression",
              callee: {
                type: "NewExpression",
                callee: {
                  type: "Identifier",
                  name: "Function"
                },
                arguments: [{
                  type: "MemberExpression",
                  computed: false,
                  object: {
                    type: "Identifier",
                    name: "xhr"
                  },
                  property: {
                    type: "Identifier",
                    name: "responseText"
                  }
                }]
              },
              arguments: []
            }
          }]
        },
        alternate: {
          type: "IfStatement",
          test: {
            type: "BinaryExpression",
            operator: "!==",
            left: {
              type: "UnaryExpression",
              operator: "typeof",
              argument: {
                type: "Identifier",
                name: "importScripts"
              },
              prefix: true
            },
            right: {
              type: "Literal",
              value: "undefined",
              raw: "\"undefined\""
            }
          },
          consequent: {
            type: "BlockStatement",
            body: [{
              type: "ExpressionStatement",
              expression: {
                type: "CallExpression",
                callee: {
                  type: "Identifier",
                  name: "importScripts"
                },
                arguments: [{
                  type: "Literal",
                  value: agentUrl,
                  raw: JSON.stringify(agentUrl)
                }]
              }
            }]
          },
          alternate: {
            type: "BlockStatement",
            body: [{
              type: "ThrowStatement",
              argument: {
                type: "NewExpression",
                callee: {
                  type: "Identifier",
                  name: "Error"
                },
                arguments: [{
                  type: "Literal",
                  value: "Unable to load BLeak agent.",
                  raw: "\"Unable to load BLeak agent.\""
                }]
              }
            }]
          }
        }
      }]
    },
    alternate: null
  };
}

function getExpressionTransform(originalFunction: FunctionExpression, scopeVarName: string): CallExpression {
  const ce: CallExpression = {
    type: "CallExpression",
    callee: {
      type: "Identifier",
      name: "$$$FUNCTION_EXPRESSION$$$",
      loc: originalFunction.loc
    },
    arguments: [originalFunction, { type: "Identifier", name: scopeVarName}],
    loc: originalFunction.loc
  };
  return ce;
}

function getScopeAssignment(functionVarName: string, scopeVarName: string): ExpressionStatement {
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
      arguments: [{
        type: "Identifier",
        name: functionVarName
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
                  argument: { type: "Identifier", name: scopeVarName }
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
        }]
      }]
    }
  };
}

function statementToBlock(s: Statement): BlockStatement {
  return {
    type: "BlockStatement",
    body: [s],
    loc: s.loc
  };
}

function statementsToBlock(parent: Node, s: Statement[]): BlockStatement {
  return {
    type: "BlockStatement",
    body: s,
    loc: parent.loc
  };
}

function declarationFromDeclarators(kind: "var" | "const" | "let", decls: VariableDeclarator[]): VariableDeclaration {
  return {
    type: "VariableDeclaration",
    kind: kind,
    declarations: decls,
    loc: {
      start: decls[0].loc.start,
      end: decls[decls.length - 1].loc.end
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


class Variable {
  constructor(
    public readonly type: VarType,
    public closedOver: boolean = false) {}
}

function closeOver(v: Variable): void {
  v.closedOver = true;
}

interface IScope {
  /**
   * Defines the given variable in the scope.
   */
  defineVariable(name: string, type: VarType): void;
  /**
   * A variable is potentially *closed over* iff an inner function
   * references it. Thus, this function checks if the variable is
   * defined within the current function. If it is, it does nothing.
   * If it is not, it tells the parent scopes to move the variable
   * into the heap.
   * @param name
   */
  maybeCloseOverVariable(name: string): void;
  /**
   * Indicates that a call to `eval` was located within this scope.
   */
  evalFound(): void;
  /**
   * Is this the top-level scope in a function?
   */
  isFunctionScope: boolean;
  /**
   * Indicates what scope, if any, the given variable should be moved to.
   * Returns NULL if the variable should not be moved.
   */
  shouldMoveTo(name: string): string;
  /**
   * The identifier of the object containing this scope's variables.
   * Defers to upper scopes if the given scope has no moved variables.
   */
  scopeIdentifier: string;
  /**
   * Finalizes the scope. The given function returns an unbound name.
   */
  finalize(getUnboundName: () => string): void;

  getScopeAssignments(): ExpressionStatement[];

  getType(name: string): VarType;
}

class GlobalScope implements IScope {
  public scopeIdentifier: string;
  constructor(scopeIdentifier = "$$$GLOBAL$$$") {
    this.scopeIdentifier = scopeIdentifier;
  }

  protected _vars = new Map<string, Variable>();
  public defineVariable(name: string, type: VarType): void {
    // Make all global variables closed over.
    this._vars.set(name, new Variable(type, true));
  }
  public maybeCloseOverVariable(name: string): void {}
  public evalFound(): void {}
  public shouldMoveTo(name: string): string {
    if (this._vars.has(name)) {
      return this.scopeIdentifier;
    } else {
      return null;
    }
  }
  public get isFunctionScope() {
    return true;
  }
  public finalize() {}
  public getScopeAssignments(): ExpressionStatement[] {
    const rv = new Array<ExpressionStatement>();
    this._vars.forEach((v, name) => {
      if (v.type === VarType.FUNCTION_DECL) {
        rv.push(getScopeAssignment(name, this.scopeIdentifier));
      }
    });
    return rv;
  }
  public getType(name: string): VarType {
    const entry = this._vars.get(name);
    if (!entry) {
      return VarType.UNKNOWN;
    }
    return entry.type;
  }
}

/**
 * ProxyScope is like GlobalScope, except all non-identifiable
 * property writes are proxied to it. Used for Eval and with()
 * statements.
 */
class ProxyScope extends GlobalScope {
  public shouldMoveTo(name: string): string {
    return this.scopeIdentifier;
  }
}

class BlockScope implements IScope  {
  // The parent scope. If null, represents the global scope.
  public readonly parent: IScope;
  protected _scopeIdentifier: string;
  public readonly isFunctionScope: boolean;
  protected _vars = new Map<string, Variable>();
  protected _closedOver: boolean = false;
  protected _evalFound = false;

  constructor(parent: IScope, isFunctionScope: boolean) {
    this.parent = parent;
    this.isFunctionScope = isFunctionScope;
  }

  public finalize(getId: () => string) {
    if (this.hasClosedOverVariables && !this._scopeIdentifier) {
      this._scopeIdentifier = getId();
    }
  }

  public getType(name: string): VarType {
    const entry = this._vars.get(name);
    if (!entry) {
      if (this.parent instanceof BlockScope) {
        return this.parent.getType(name);
      } else {
        return VarType.UNKNOWN;
      }
    }
    return entry.type;
  }

  /**
   * Returns the scope that will act as this scope's parent
   * in the final JavaScript code. We do not emit scopes
   * whose variables are not closed over.
   */
  protected _getEffectiveParent(): IScope {
    let p = this.parent;
    while (p instanceof BlockScope && !p._closedOver) {
      p = p.parent;
    }
    return p;
  }

  public defineVariable(name: string, type: VarType): void {
    if (type === VarType.VAR && !this.isFunctionScope) {
      // VAR types must be defined in the top-most scope of a function.
      return this.parent.defineVariable(name, type);
    }
//    if (this._vars.has(name)) {
      // Merge.
//      console.warn(`Unifying two variables named ${name}!`);
//    }
    this._vars.set(name, new Variable(type, this._evalFound));
  }

  public maybeCloseOverVariable(name: string): void {
    if (!this._vars.has(name) && this.parent !== null) {
      if (this.isFunctionScope && this.parent instanceof BlockScope) {
        // Parent belongs to a different function.
        this.parent._closeOverVariable(name);
      } else {
        // Parent *does not* belong to a different function.
        this.parent.maybeCloseOverVariable(name);
      }
    }
  }

  protected _closeOverVariable(name: string): void {
    const v = this._vars.get(name);
    if (v) {
      v.closedOver = true;
      this._closedOver = true;
    } else if (this.parent instanceof BlockScope) {
      this.parent._closeOverVariable(name);
    } else {
      // Otherwise, it's a global variable!
      this.parent.maybeCloseOverVariable(name);
    }
  }

  public shouldMoveTo(name: string): string | null {
    const v = this._vars.get(name);
    if (v) {
      if (v.closedOver) {
        return this.scopeIdentifier;
      } else {
        return null;
      }
    } else {
      return this.parent.shouldMoveTo(name);
    }
  }

  /**
   * Called when a call to eval() is located.
   * Closes over every single variable.
   */
  public evalFound(): void {
    this._evalFound = true;
    this._closedOver = true;
    this._vars.forEach(closeOver);
    this.parent.evalFound();
  }

  public get scopeIdentifier(): string {
    if (!this.hasClosedOverVariables) {
      return this.parent.scopeIdentifier;
    }
    if (this._scopeIdentifier === null) {
      throw new Error(`Cannot retrieve scope identifier of unfinalized scope.`);
    }
    return this._scopeIdentifier;
  }

  public get hasClosedOverVariables(): boolean {
    return this._closedOver;
  }

  public getScopeAssignments(): ExpressionStatement[] {
    const rv = new Array<ExpressionStatement>();
    this._vars.forEach((v, name) => {
      if (v.type === VarType.FUNCTION_DECL) {
        rv.push(getScopeAssignment(name, this.scopeIdentifier));
      }
    });
    return rv;
  }

  public getScopeCreationStatement(): VariableDeclaration {
    const parent = this._getEffectiveParent();
    const movedIdentifiers: string[] = [];
    const unmovedIdentifiers: string[] = [];
    const params: string[] = [];

    this._vars.forEach((v, name) => {
      if (v.closedOver) {
        switch (v.type) {
          case VarType.ARG:
            params.push(name);
            break;
          case VarType.CONST:
          case VarType.FUNCTION_DECL:
            unmovedIdentifiers.push(name);
            break;
          case VarType.LET:
          case VarType.VAR:
            movedIdentifiers.push(name);
            break;
        }
      }
    });

    return {
      type: "VariableDeclaration",
      declarations: [{
        type: "VariableDeclarator",
        id: { type: "Identifier", name: this.scopeIdentifier },
        init: {
          type: "CallExpression",
          callee: { type: "Identifier", name: "$$$CREATE_SCOPE_OBJECT$$$" },
          arguments: [
            {
              type: "Identifier",
              name: parent.scopeIdentifier
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
}

/**
 * AST visitor that only visits nodes that are relevant to our program transformations.
 */
abstract class Visitor {
  protected _strictMode = false;

  protected _isStrict(n: Node[]): boolean {
    return n.length > 0 && n[0].type === "ExpressionStatement" && (<any> n[0])['directive'] === 'use strict';
  }

  /**
   * [Internal] Visit an array of nodes.
   * @param st
   */
  public NodeArray(st: Node[]): Node[] {
    const len = st.length;
    let multipleStatementsEncountered = false;
    for (let i = 0; i < len; i++) {
      const s = st[i];
      const newS = (<any> this[s.type])(s);
      if (newS === undefined) {
        console.log("Got undefined processing the following:")
        console.log(s);
      }
      st[i] = newS;
      if ((<any> st[i].type) === "MultipleStatements") {
        multipleStatementsEncountered = true;
      }
    }

    if (multipleStatementsEncountered) {
      let n = new Array<Node>();
      for (let i = 0; i < len; i++) {
        const s = st[i];
        if ((<any> s).type === "MultipleStatements") {
          n.push(...(<MultipleStatements> <any> s).body);
        } else {
          n.push(s);
        }
      }
      return n;
    }

    return st;
  }

  protected _setStrictMode(statements: Node[]): void {
    this._strictMode = this._isStrict(statements);
  }

  public Program(p: Program): Program {
    const oldStrictMode = this._strictMode;
    this._setStrictMode(p.body);
    p.body = <any[]> this.NodeArray(p.body);
    this._strictMode = oldStrictMode;
    return p;
  }

  public EmptyStatement(e: EmptyStatement): EmptyStatement {
    return e;
  }

  public BlockStatement(b: BlockStatement): BlockStatement {
    b.body = <any[]> this.NodeArray(b.body);
    return b;
  }

  public ExpressionStatement(es: ExpressionStatement): ExpressionStatement {
    const exp = es.expression;
    es.expression = (<any> this[exp.type])(exp);
    return es;
  }

  public IfStatement(is: IfStatement): IfStatement {
    const test = is.test;
    is.test = (<any> this[test.type])(test);
    const cons = is.consequent;
    is.consequent = (<any> this[cons.type])(cons);
    const alt = is.alternate;
    if (alt) {
      is.alternate = (<any> this[alt.type])(alt);
    }
    return is;
  }

  public LabeledStatement(ls: LabeledStatement): LabeledStatement {
    const body = ls.body;
    ls.body = (<any> this[body.type])(body);
    return ls;
  }

  public BreakStatement(bs: BreakStatement): BreakStatement {
    return bs;
  }

  public ContinueStatement(cs: ContinueStatement): ContinueStatement {
    return cs;
  }

  public WithStatement(ws: WithStatement): WithStatement | BlockStatement {
    ws.object = (<any> this[ws.object.type])(ws.object);
    ws.body = (<any> this[ws.body.type])(ws.body);
    return ws;
  }

  public SwitchStatement(ss: SwitchStatement): SwitchStatement {
    const disc = ss.discriminant;
    ss.discriminant = (<any> this[disc.type])(disc);
    const cases = ss.cases;
    const len = cases.length;
    for (let i = 0; i < len; i++) {
      const c = cases[i];
      cases[i] = (<any> this[c.type])(c);
    }
    return ss;
  }

  public ReturnStatement(rs: ReturnStatement): ReturnStatement {
    const arg = rs.argument;
    if (arg) {
      rs.argument = (<any> this[arg.type])(arg);
    }
    return rs;
  }

  public ThrowStatement(ts: ThrowStatement): ThrowStatement {
    const arg = ts.argument;
    ts.argument = (<any> this[arg.type])(arg);
    return ts;
  }

  public TryStatement(ts: TryStatement): TryStatement {
    ts.block = this.BlockStatement(ts.block);
    if (ts.finalizer) {
      ts.finalizer = this.BlockStatement(ts.finalizer);
    }
    if (ts.handler) {
      ts.handler = this.CatchClause(ts.handler);
    }
    return ts;
  }

  protected _WhileOrDoWhileStatement(n: DoWhileStatement): DoWhileStatement;
  protected _WhileOrDoWhileStatement(n: WhileStatement): WhileStatement;
  protected _WhileOrDoWhileStatement(n: WhileStatement | DoWhileStatement): WhileStatement | DoWhileStatement {
    const test = n.test;
    n.test = (<any> this[test.type])(test);
    const body = n.body;
    n.body = (<any> this[body.type])(body);
    return n;
  }

  public WhileStatement(n: WhileStatement): WhileStatement {
    return this._WhileOrDoWhileStatement(n);
  }

  public DoWhileStatement(n: DoWhileStatement): DoWhileStatement {
    return this._WhileOrDoWhileStatement(n);
  }

  public ForStatement(n: ForStatement): ForStatement | MultipleStatements {
    const test = n.test;
    if (test) {
      n.test = (<any> this[test.type])(test);
    }
    const body = n.body;
    n.body = (<any> this[body.type])(body);
    const init = n.init;
    if (init) {
      n.init = (<any> this[init.type])(init);
    }
    const update = n.update;
    if (update) {
      n.update = (<any> this[update.type])(update);
    }
    return n;
  }

  protected _ForInAndOfStatement(n: ForInStatement): ForInStatement;
  protected _ForInAndOfStatement(n: ForOfStatement): ForOfStatement;
  protected _ForInAndOfStatement(n: ForInStatement | ForOfStatement): ForInStatement | ForOfStatement {
    const left = n.left;
    n.left = (<any> this[left.type])(left);
    const right = n.right;
    n.right = (<any> this[right.type])(right);
    const body = n.body;
    n.body = (<any> this[body.type])(body);
    return n;
  }

  public ForInStatement(n: ForInStatement): ForInStatement {
    return this._ForInAndOfStatement(n);
  }

  public ForOfStatement(n: ForOfStatement): ForOfStatement {
    return this._ForInAndOfStatement(n);
  }

  public DebuggerStatement(n: DebuggerStatement): DebuggerStatement {
    return n;
  }

  protected _Function(n: FunctionExpression): FunctionExpression;
  protected _Function(n: FunctionDeclaration): FunctionDeclaration;
  protected _Function(n: FunctionDeclaration | FunctionExpression): FunctionDeclaration | FunctionExpression {
    const oldStrictMode = this._strictMode;
    if (n.async) {
      throw new Error(`Async functions are not yet supported.`);
    }
    if (n.generator) {
      throw new Error(`Generators are not yet supported.`);
    }
    this._setStrictMode(n.body.body);
    n.body = this.BlockStatement(n.body);
    this._strictMode = oldStrictMode;
    return n;
  }

  public FunctionDeclaration(n: FunctionDeclaration): FunctionDeclaration | VariableDeclaration {
    return this._Function(n);
  }

  public FunctionExpression(n: FunctionExpression): FunctionExpression | CallExpression {
    return this._Function(n);
  }

  public VariableDeclaration(n: VariableDeclaration): VariableDeclaration | MultipleStatements | ExpressionStatement {
    const decls = n.declarations;
    const len = decls.length;
    for (let i = 0; i < len; i++) {
      decls[i] = <VariableDeclarator> this.VariableDeclarator(decls[i]);
    }
    return n;
  }

  public VariableDeclarator(n: VariableDeclarator): VariableDeclarator | MemberExpression | ExpressionStatement {
    const init = n.init;
    if (init) {
      n.init = (<any> this[init.type])(init);
    }
    return n;
  }

  public ThisExpression(n: ThisExpression): ThisExpression {
    return n;
  }

  public ArrayExpression(n: ArrayExpression): ArrayExpression {
    const elements = n.elements;
    const len = elements.length;
    for (let i = 0; i < len; i++) {
      const e = elements[i];
      // Possible for this to be null, as in:
      // var a = [,1,2];
      if (e !== null) {
        elements[i] = (<any> this[e.type])(e);
      }
    }
    return n;
  }

  public ObjectExpression(n: ObjectExpression): ObjectExpression {
    const props = n.properties;
    const len = props.length;
    for (let i = 0; i < len; i++) {
      const prop = props[i];
      props[i] = this.Property(prop);
    }
    return n;
  }

  public Property(n: Property): Property {
    switch (n.kind) {
      case "init": {
        const val = n.value;
        n.value = (<any> this[val.type])(val);
        return n;
      }
      case "get":
      case "set":
        // TODO: Special functions with no scope???
      default:
        throw new Error(`Property of kind ${n.kind} not yet supported.`);
    }
  }

  public SequenceExpression(n: SequenceExpression): SequenceExpression {
    n.expressions = <any[]> this.NodeArray(n.expressions);
    return n;
  }

  public UnaryExpression(n: UnaryExpression): UnaryExpression {
    const arg = n.argument;
    n.argument = (<any> this[arg.type])(arg);
    return n;
  }

  public BinaryExpression(n: BinaryExpression): BinaryExpression | UnaryExpression | CallExpression {
    const left = n.left;
    n.left = (<any> this[left.type])(left);
    const right = n.right;
    n.right = (<any> this[right.type])(right);
    return n;
  }

  public AssignmentExpression(n: AssignmentExpression): AssignmentExpression {
    const left = n.left;
    n.left = (<any> this[left.type])(left);
    const right = n.right;
    n.right = (<any> this[right.type])(right);
    return n;
  }

  public UpdateExpression(n: UpdateExpression): UpdateExpression {
    const arg = n.argument;
    n.argument = (<any> this[arg.type])(arg);
    return n;
  }

  public LogicalExpression(n: LogicalExpression): LogicalExpression {
    const left = n.left;
    n.left = (<any> this[left.type])(left);
    const right = n.right;
    n.right = (<any> this[right.type])(right);
    return n;
  }

  public ConditionalExpression(n: ConditionalExpression): ConditionalExpression {
    const alt = n.alternate;
    n.alternate = (<any> this[alt.type])(alt);
    const cons = n.consequent;
    n.consequent = (<any> this[cons.type])(cons);
    const test = n.test;
    n.test = (<any> this[test.type])(test);
    return n;
  }

  public CallExpression(n: CallExpression): CallExpression {
    const callee = n.callee;
    n.callee = (<any> this[callee.type])(callee);
    const args = n.arguments;
    const len = args.length;
    for (let i = 0; i < len; i++) {
      const arg = args[i];
      args[i] = (<any> this[arg.type])(arg);
    }
    return n;
  }

  public NewExpression(n: NewExpression): NewExpression {
    const callee = n.callee;
    n.callee = (<any> this[callee.type])(callee);
    const args = n.arguments;
    const len = args.length;
    for (let i = 0; i < len; i++) {
      const arg = args[i];
      args[i] = (<any> this[arg.type])(arg);
    }
    return n;
  }

  public MemberExpression(n: MemberExpression): MemberExpression {
    // Rewrite object, the target of the member expression.
    // Leave the property name alone.
    if (n.computed) {
      n.property = (<any> this[n.property.type])(n.property);
    }
    const obj = n.object;
    n.object = (<any> this[obj.type])(obj);
    return n;
  }

  public SwitchCase(n: SwitchCase): SwitchCase {
    const test = n.test;
    if (test) {
      n.test = (<any> this[test.type])(test);
    }
    n.consequent = <any[]> this.NodeArray(n.consequent);
    return n;
  }

  public CatchClause(n: CatchClause): CatchClause {
    n.body = this.BlockStatement(n.body);
    return n;
  }

  public Identifier(n: Identifier): Identifier | MemberExpression {
    return n;
  }

  public Literal(n: Literal): Literal {
    return n;
  }

  public Super(n: Super): Super {
    throw new Error(`Super is not yet supported.`);
  }

  public SpreadElement(n: SpreadElement): SpreadElement {
    throw new Error(`SpreadElement is not yet supported.`);
  }

  public ArrowFunctionExpression(n: ArrowFunctionExpression): ArrowFunctionExpression {
    throw new Error(`ArrowFunctionExpression is not yet supported.`);
  }

  public YieldExpression(n: YieldExpression): YieldExpression {
    throw new Error(`YieldExpression is not yet supported.`);
  }

  public TemplateLiteral(n: TemplateLiteral): TemplateLiteral {
    throw new Error(`TemplateLiteral is not yet supported.`);
  }

  public TaggedTemplateExpression(n: TaggedTemplateExpression): TaggedTemplateExpression {
    throw new Error(`TaggedTemplateExpression is not yet supported.`);
  }

  public TemplateElement(n: TemplateElement): TemplateElement {
    throw new Error(`TemplateElement is not yet supported.`);
  }

  public ObjectPattern(n: ObjectPattern): ObjectPattern {
    throw new Error(`ObjectPattern is not yet supported.`);
  }

  public ArrayPattern(n: ArrayPattern): ArrayPattern {
    throw new Error(`ArrayPattern is not yet supported.`);
  }

  public RestElement(n: RestElement): RestElement {
    throw new Error(`RestElement is not yet supported.`);
  }

  public AssignmentPattern(n: AssignmentPattern): AssignmentPattern {
    throw new Error(`AssignmentPattern is not yet supported.`);
  }

  public ClassBody(n: ClassBody): ClassBody {
    throw new Error(`ClassBody is not yet supported.`);
  }

  public MethodDefinition(n: MethodDefinition): MethodDefinition {
    throw new Error(`MethodDefinition is not yet supported.`);
  }

  public ClassDeclaration(n: ClassDeclaration): ClassDeclaration {
    throw new Error(`ClassDeclaration is not yet supported.`);
  }

  public ClassExpression(n: ClassExpression): ClassExpression {
    throw new Error(`ClassExpression is not yet supported.`);
  }

  public MetaProperty(n: MetaProperty): MetaProperty {
    throw new Error(`MetaProperty is not yet supported.`);
  }

  public ImportDeclaration(n: ImportDeclaration): ImportDeclaration {
    throw new Error(`ImportDeclaration is not yet supported.`);
  }

  public ImportSpecifier(n: ImportSpecifier): ImportSpecifier {
    throw new Error(`ImportSpecifier is not yet supported.`);
  }

  public ImportDefaultSpecifier(n: ImportDefaultSpecifier): ImportDefaultSpecifier {
    throw new Error(`ImportDefaultSpecifier is not yet supported.`);
  }

  public ImportNamespaceSpecifier(n: ImportNamespaceSpecifier): ImportNamespaceSpecifier {
    throw new Error(`ImportNamespaceSpecifier is not yet supported.`);
  }

  public ExportNamedDeclaration(n: ExportNamedDeclaration): ExportNamedDeclaration {
    throw new Error(`ExportNamedDeclaration is not yet supported.`);
  }

  public ExportSpecifier(n: ExportSpecifier): ExportSpecifier {
    throw new Error(`ExportSpecifier is not yet supported.`);
  }

  public ExportDefaultDeclaration(n: ExportDefaultDeclaration): ExportDefaultDeclaration {
    throw new Error(`ExportDefaultDeclaration is not yet supported.`);
  }

  public ExportAllDeclaration(n: ExportAllDeclaration): ExportAllDeclaration {
    throw new Error(`ExportAllDeclaration is not yet supported.`);
  }

  public AwaitExpression(n: AwaitExpression): AwaitExpression {
    throw new Error(`AwaitExpression is not yet supported.`);
  }
}

/**
 * Collects information about scopes in the program and performs the following transformations:
 *
 * - Function declarations that are *not* in a top-most function scope are rewritten to be
 *   function expressions. This is undefined behavior in JavaScript, and our rewritten code
 *   is consistent with V8's behavior.
 * - Single-line bodies of conditionals are converted into block statements.
 * - Moves multiple variable declarators in For loops into parent.
 */
class ScopeScanningVisitor extends Visitor {
  public static Visit(ast: Program, scopeMap: Map<Program | BlockStatement, BlockScope>, symbols: Set<string>, globalScope: IScope = new GlobalScope()): Program {
    const visitor = new ScopeScanningVisitor(scopeMap, symbols, globalScope);
    return visitor.Program(ast);
  }

  private _scope: IScope = null;
  private _nextBlockIsFunction = false;
  private _nextBlockIsWith = false;
  private _defineInNextBlock: {type: VarType, name: string}[] = [];
  private _scopeMap: Map<Program | BlockStatement, IScope>;
  private _symbols: Set<string>;

  private constructor(scopeMap: Map<Program | BlockStatement, BlockScope>, symbols: Set<string>, globalScope: IScope) {
    super();
    this._scopeMap = scopeMap;
    this._symbols = symbols;
    this._scope = globalScope;
  }

  public Program(p: Program): Program {
    const rv = super.Program(p);
    this._scopeMap.set(rv, this._scope);
    return rv;
  }

  public FunctionDeclaration(fd: FunctionDeclaration): FunctionDeclaration | VariableDeclaration {
    if (!this._scope.isFunctionScope) {
      // Undefined behavior! Function declaration is not in top-level scope of function.
      // Turn into a function expression assignment to a var. Chrome seems to treat it as such.
      // Will be re-visited later as a FunctionExpression.
      const rewrite: VariableDeclaration = {
        type: "VariableDeclaration",
        declarations: [{
          type: "VariableDeclarator",
          id: fd.id,
          init: {
            type: "FunctionExpression",
            // Remove name of function to avoid clashes with
            // new variable name.
            id: null,
            params: fd.params,
            body: fd.body,
            generator: fd.generator,
            async: fd.async,
            loc: fd.loc
          },
          loc: fd.loc
        }],
        kind: "var",
        loc: fd.loc
      };
      return <VariableDeclaration> this.VariableDeclaration(rewrite);
    } else {
      this._nextBlockIsFunction = true;
      const args = fd.params;
      for (const arg of args) {
        switch (arg.type) {
          case "Identifier":
            this._defineInNextBlock.push({type: VarType.ARG, name: arg.name});
            break;
          default:
            throw new Error(`Unsupported function parameter type: ${arg.type}`);
        }
      }
      this._scope.defineVariable(fd.id.name, VarType.FUNCTION_DECL);
      this._symbols.add(fd.id.name);
      return super.FunctionDeclaration(fd);
    }
  }

  public FunctionExpression(fe: FunctionExpression): FunctionExpression {
    if (fe.id) {
      this._defineInNextBlock.push({type: VarType.CONST, name: fe.id.name });
    }
    const args = fe.params;
    for (const arg of args) {
      switch (arg.type) {
        case "Identifier":
          this._defineInNextBlock.push({type: VarType.ARG, name: arg.name});
          break;
        default:
          throw new Error(`Unsupported function parameter type: ${arg.type}`);
      }
    }
    this._nextBlockIsFunction = true;
    const rv = <FunctionExpression> super.FunctionExpression(fe);
    // Rewrite.
    return rv;
  }

  public BlockStatement(bs: BlockStatement): BlockStatement {
    const oldBs = this._scope;
    if (this._nextBlockIsWith) {
      this._nextBlockIsWith = false;
      this._scope = new BlockScope(new ProxyScope(), this._nextBlockIsFunction);
    } else {
      this._scope = new BlockScope(oldBs, this._nextBlockIsFunction);
    }
    this._nextBlockIsFunction = false;
    if (this._defineInNextBlock.length > 0) {
      const dinb = this._defineInNextBlock;
      for (const v of dinb) {
        this._scope.defineVariable(v.name, v.type);
        this._symbols.add(v.name);
      }
      this._defineInNextBlock = [];
    }
    const rv = super.BlockStatement(bs);
    this._scopeMap.set(bs, this._scope);
    this._scope = oldBs;
    return rv;
  }

  public VariableDeclaration(vd: VariableDeclaration): VariableDeclaration | MultipleStatements | ExpressionStatement {
    let kind: VarType;
    switch (vd.kind) {
      case "var":
        kind = VarType.VAR;
        break;
      case "let":
        kind = VarType.LET;
        break;
      case "const":
        kind = VarType.CONST;
        break;
      default:
        throw new Error(`Unrecognized variable declaration type: ${vd.kind}`);
    }

    const decls = vd.declarations;
    for (const decl of decls) {
      const id = decl.id;
      switch (id.type) {
        case "Identifier":
          this._scope.defineVariable(id.name, kind);
          this._symbols.add(id.name);
          break;
        default:
          throw new Error(`Unrecognized variable declaration type: ${id.type}`);
      }
    }

    return super.VariableDeclaration(vd);
  }

  public BinaryExpression(bd: BinaryExpression): BinaryExpression | UnaryExpression | CallExpression {
    const rv = <BinaryExpression> super.BinaryExpression(bd);
    // Rewrite equality so that Proxy(A) and A are equivalent.
    const op = bd.operator;
    switch (op) {
      case '===':
      case '==':
      case '!==':
      case '!=': {
        const strict = op.length === 3;
        const not = op[0] === '!';
        const ce: CallExpression = {
          type: "CallExpression",
          callee: {
            type: "Identifier",
            name: `$$$${strict ? 'S' : ''}EQ$$$`
          },
          arguments: [
            rv.left,
            rv.right
          ],
          loc: rv.loc
        };
        if (not) {
          const ue: UnaryExpression = {
            type: "UnaryExpression",
            operator: "!",
            argument: ce,
            loc: rv.loc,
            prefix: true
          };
          return this.UnaryExpression(ue);
        } else {
          return this.CallExpression(ce);
        }
      }
      default:
        return rv;
    }
  }

  public CatchClause(cc: CatchClause): CatchClause {
    const param = cc.param;
    switch (param.type) {
      case "Identifier":
        this._defineInNextBlock.push({ type: VarType.ARG, name: param.name });
        this._symbols.add(param.name);
        break;
      default:
        throw new Error(`Unrecognized parameter type in catch clause: ${param.type}`);
    }
    return super.CatchClause(cc);
  }

  public Identifier(n: Identifier): Identifier | MemberExpression {
    this._symbols.add(n.name);
    this._scope.maybeCloseOverVariable(n.name);
    return n;
  }

  public CallExpression(ce: CallExpression): CallExpression {
    const id = ce.callee;
    if (id.type === "Identifier" && id.name === "eval") {
      this._scope.evalFound();
    }
    return super.CallExpression(ce);
  }

  public IfStatement(is: IfStatement): IfStatement {
    const cons = is.consequent;
    if (cons.type !== "BlockStatement") {
      is.consequent = statementToBlock(cons);
    }

    const alt = is.alternate;
    if (alt) {
      switch (alt.type) {
        case "IfStatement": // Valid `else if`
        case "BlockStatement": // Valid `else`
          break;
        default:
          // Single-line else.
          is.alternate = statementToBlock(alt);
          break;
      }
    }

    return super.IfStatement(is);
  }

  protected _WhileOrDoWhileStatement(n: DoWhileStatement): DoWhileStatement;
  protected _WhileOrDoWhileStatement(n: WhileStatement): WhileStatement;
  protected _WhileOrDoWhileStatement(ws: WhileStatement | DoWhileStatement): WhileStatement | DoWhileStatement {
    if (ws.body.type !== "BlockStatement") {
      ws.body = statementToBlock(ws.body);
    }
    return super._WhileOrDoWhileStatement(<any> ws);
  }

  protected _ForInAndOfStatement(n: ForInStatement): ForInStatement;
  protected _ForInAndOfStatement(n: ForOfStatement): ForOfStatement;
  protected _ForInAndOfStatement(fs: ForInStatement | ForOfStatement): ForInStatement | ForOfStatement {
    if (fs.body.type !== "BlockStatement") {
      fs.body = statementToBlock(fs.body);
    }
    return super._ForInAndOfStatement(<any> fs);
  }

  public SwitchCase(sc: SwitchCase): SwitchCase {
    const cons = sc.consequent;
    if (cons.length !== 1 || cons[0].type !== "BlockStatement") {
      sc.consequent = [
        statementsToBlock(sc, cons)
      ];
    }
    return super.SwitchCase(sc);
  }

  public ForStatement(fs: ForStatement): ForStatement | MultipleStatements {
    if (fs.body.type !== "BlockStatement") {
      fs.body = statementToBlock(fs.body);
    }
    const init = fs.init;
    if (init && init.type === "VariableDeclaration" && init.declarations.length > 1) {
      // Hoist declaration outside of loop, otherwise it may cause trouble for us down the road
      // in subsequent AST modifications.
      fs.init = null;
      return {
        type: "MultipleStatements",
        body: [
          <VariableDeclaration> this.VariableDeclaration(init),
          <ForStatement> super.ForStatement(fs)],
        loc: fs.loc
      };
    }
    return super.ForStatement(fs);
  }

  public WithStatement(ws: WithStatement): WithStatement | BlockStatement {
    if (ws.body.type !== "BlockStatement") {
      ws.body = {
        type: "BlockStatement",
        body: [ws.body],
        loc: ws.body.loc
      };
    }

    // Treat like an eval; toss everything.
    this._scope.evalFound();
    this._nextBlockIsWith = true;

    return super.WithStatement(ws);
  }
}

/**
 * Creates scope objects where needed, moves closed-over variables into them, and
 * assigns __scope__ on function objects.
 */
class ScopeCreationVisitor extends Visitor {
  public static Visit(ast: Program, scopeMap: Map<Program | BlockStatement, IScope>, symbols: Set<string>, agentUrl: string): Program {
    const visitor = new ScopeCreationVisitor(scopeMap, symbols, agentUrl);
    return visitor.Program(ast);
  }

  protected _scopeMap: Map<Program | BlockStatement, IScope>;
  protected _scope: IScope = null;
  protected _agentUrl: string;
  protected _symbols: Set<string>;
  private _nextScope = 0;
  private _getNextScope = () => {
    let name: string;
    do {
      name = `s${this._nextScope++}`;
    } while (this._symbols.has(name));
    this._symbols.add(name);
    return name;
  };
  private constructor(scopeMap: Map<Program | BlockStatement, IScope>, symbols: Set<string>, agentUrl: string) {
    super();
    this._scopeMap = scopeMap;
    this._symbols = symbols;
    this._agentUrl = agentUrl;
  }

  protected _insertScopeCreationAndFunctionScopeAssignments(n: Node[], isProgram: boolean): Node[] {
    let mods: Node[] = this._scope instanceof BlockScope && this._scope.hasClosedOverVariables ? [this._scope.getScopeCreationStatement()] : [];
    if (isProgram) {
      mods = (<Node[]> [getProgramPrelude(this._agentUrl)]).concat(mods);
    }
    mods = mods.concat(this._scope.getScopeAssignments());
    if (mods.length === 0) {
      return n;
    }
    const isStrict = this._isStrict(n);
    const offset = isStrict ? 1 : 0;
    return n.slice(0, offset).concat(mods).concat(n.slice(offset));
  }

  public Program(p: Program): Program {
    this._scope = this._scopeMap.get(p);
    this._scope.finalize(this._getNextScope);
    const rv = super.Program(p);
    p.body = <any> this._insertScopeCreationAndFunctionScopeAssignments(p.body, true);
    this._scope = null;
    return rv;
  }

  public BlockStatement(bs: BlockStatement): BlockStatement {
    const oldBs = this._scope;
    this._scope = this._scopeMap.get(bs);
    this._scope.finalize(this._getNextScope);
    const rv = super.BlockStatement(bs);
    rv.body = <any> this._insertScopeCreationAndFunctionScopeAssignments(rv.body, false);
    this._scope = oldBs;
    return rv;
  }

  public Identifier(i: Identifier): Identifier | MemberExpression {
    const to = this._scope.shouldMoveTo(i.name);
    if (to) {
      return {
        type: "MemberExpression",
        computed: false,
        object: {
          type: "Identifier",
          name: to,
          loc: i.loc
        },
        property: {
          type: "Identifier",
          name: i.name,
          loc: i.loc
        },
        loc: i.loc
      };
    }
    return i;
  }

  public VariableDeclarator(decl: VariableDeclarator): VariableDeclarator | MemberExpression | ExpressionStatement {
    const id = decl.id;
    if (id.type !== "Identifier") {
      throw new Error(`Does not support variable declarations with non-identifiers.`);
    }
    const init = decl.init;
    if (init) {
      decl.init = (<any> this[init.type])(init);
    }
    const newId = this.Identifier(id);
    if (newId.type === "MemberExpression") {
      if (decl.init) {
        return {
          type: "ExpressionStatement",
          expression: {
            type: "AssignmentExpression",
            operator: "=",
            left: newId,
            right: decl.init,
            loc: decl.loc
          },
          loc: decl.loc
        };
      } else {
        newId.loc = decl.loc;
        return newId;
      }
    } else {
      return decl;
    }
  }

  public VariableDeclaration(vd: VariableDeclaration): VariableDeclaration | MultipleStatements | ExpressionStatement {
    // Note: Order is important, as initializers may have side effects.
    const newDecls = vd.declarations.map((d) => this.VariableDeclarator(d));
    let s = new Array<ExpressionStatement | VariableDeclaration>();
    let currentDecls = new Array<VariableDeclarator>();
    const len = newDecls.length;
    for (let i = 0; i < len; i++) {
      const d = newDecls[i];
      switch (d.type) {
        case "VariableDeclarator":
          currentDecls.push(d);
          break;
        case "MemberExpression":
          // No initializer; side-effect free. Don't emit anything.
          break;
        case "ExpressionStatement":
          if (currentDecls.length > 0) {
            s.push(declarationFromDeclarators(vd.kind, currentDecls));
            currentDecls = [];
          }
          s.push(d);
          break;
      }
    }

    if (currentDecls.length === vd.declarations.length) {
      s.push(vd);
    } else if (currentDecls.length > 0) {
      s.push(declarationFromDeclarators(vd.kind, currentDecls));
    }

    if (s.length === 0) {
      // Return an empty variable declarator, which works when
      // this is used as an expression or a statement.
      return {
        type: "VariableDeclaration",
        kind: "var",
        declarations: [{
          type: "VariableDeclarator",
          id: { type: "Identifier", name: this._getNextScope()}
        }]
      };
    } else if (s.length !== 1) {
      // Emit also if length is 0!!
      return {
        type: "MultipleStatements",
        body: s
      };
    } else {
      return s[0];
    }
  }

  protected _ForInAndOfStatement(n: ForInStatement): ForInStatement;
  protected _ForInAndOfStatement(n: ForOfStatement): ForOfStatement;
  protected _ForInAndOfStatement(fs: ForInStatement | ForOfStatement): ForInStatement | ForOfStatement {
    const rv = super._ForInAndOfStatement(<any> fs);
    const left = rv.left;
    // Cannot have statements on the left of a `for in` or `for of`.
    // Unwrap into an expression.
    if ((<any> left).type === "ExpressionStatement") {
      rv.left = (<ExpressionStatement><any> left).expression;
    }
    return rv;
  }

  public ForStatement(f: ForStatement): ForStatement | MultipleStatements {
    const rv = <ForStatement> super.ForStatement(f);
    const init = rv.init;
    // Cannot have statements for the initialization expression.
    // Unwrap into an expression.
    if (init && (<any> init).type === "ExpressionStatement") {
      rv.init = (<ExpressionStatement> <any> init).expression;
    }
    return rv;
  }

  public CallExpression(ce: CallExpression): CallExpression {
    const oldCallee = ce.callee;
    const rv = super.CallExpression(ce);
    const callee = rv.callee;
    const scopeId = this._scope.scopeIdentifier;
    switch (callee.type) {
      case "Identifier":
        if (callee.name === "eval") {
          callee.name = "$$$REWRITE_EVAL$$$";
          rv.arguments.unshift({
            type: "Identifier",
            name: scopeId
          });
        }
        break;
      case "MemberExpression":
        if (oldCallee.type === "Identifier") {
          // We moved the target into the heap.
          // Translate into a LogicalExpression to preserve the value of `this`.
          rv.callee = {
            type: "LogicalExpression",
            operator: "||",
            left: callee,
            right: callee,
            loc: callee.loc
          };
        }
        break;
    }
    return rv;
  }

  public FunctionExpression(fe: FunctionExpression): CallExpression {
    const rv = <FunctionExpression> super.FunctionExpression(fe);
    // Scope assignment.
    return getExpressionTransform(rv, this._scope.scopeIdentifier);
  }

  /*public UpdateExpression(ue: UpdateExpression): UpdateExpression | SequenceExpression {
    const oldArg = ue.argument;
    const rv = super.UpdateExpression(ue);
    const arg = ue.argument;
    if (!this._isStrict && oldArg.type !== arg.type && oldArg.type === "Identifier" && this._blockScope.getType(oldArg.name) === VarType.ARG) {
      // Update is applied to an argument that was moved to the heap.
      // Turn into sequence expression so RHS is consistent.
      // NOOOO. Doesn't work for var a = l++;
      return {
        type: "SequenceExpression",
        expressions: [
          {
            type: "UpdateExpression",
            operator: ue.operator,
            argument: oldArg,
            prefix: ue.prefix,
            loc: ue.loc
          },
          rv
        ],
        loc: ue.loc
      };
    }
    return rv;
  }*/

  public AssignmentExpression(node: AssignmentExpression): AssignmentExpression {
    const oldLeft = node.left;
    const rv = super.AssignmentExpression(node);
    // Check if LHS is an argument and if we are not in strict mode.
    // If so, arguments object is aliased to individual arguments. Some code relies on this aliasing.
    const left = rv.left;
    if (!this._isStrict && oldLeft.type !== left.type && oldLeft.type === "Identifier" && this._scope.getType(oldLeft.name) === VarType.ARG) {
      // Rewrite RHS to assign to actual argument variable, too.
      // Works even if RHS is +=, etc.
      return <AssignmentExpression> {
        type: "AssignmentExpression",
        operator: "=",
        left: {
          type: "Identifier",
          name: oldLeft.name
        },
        right: rv,
        loc: rv.loc
      };
    }
    return rv;
  }

  public WithStatement(node: WithStatement): WithStatement | BlockStatement {
    const id = this._getNextScope();
    let v: VariableDeclaration = {
      type: "VariableDeclaration",
      kind: "var",
      declarations: [{
        type: "VariableDeclarator",
        id: { type: "Identifier", name: id },
        init: {
          type: "CallExpression",
          callee: {
            type: "Identifier",
            name: "$$$CREATE_WITH_SCOPE$$$"
          },
          arguments:[(<any> this[node.object.type])(node.object), { type: "Identifier", name: this._scope.scopeIdentifier }]
        }
      }],
      loc: node.object.loc
    };
    node.object = {
      type: "Identifier",
      name: id
    };
    const scope = <BlockScope> this._scopeMap.get(<BlockStatement> node.body);
    if (!(scope.parent instanceof ProxyScope)) {
      throw new Error(`?!??!!?`);
    }
    scope.parent.scopeIdentifier = id;
    const rv = this.BlockStatement(<BlockStatement> node.body);
    rv.body = <any> (<Node[]> [v]).concat(rv.body);
    return rv;
  }

  // Shortcomings: ++ to arguments.
}

/**
 * Given a JavaScript source file, modifies all function declarations and expressions to expose
 * their closure state on the function object.
 *
 * @param source Source of the JavaScript file.
 */
export function exposeClosureState(filename: string, source: string, agentUrl="bleak_agent.js", evalScopeName?: string): string {
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

  const map = new Map<Program | BlockStatement, BlockScope>();
  const symbols = new Set<string>();
  ast = ScopeCreationVisitor.Visit(ScopeScanningVisitor.Visit(ast, map, symbols, evalScopeName ? new BlockScope(new ProxyScope(evalScopeName), true) : undefined), map, symbols, agentUrl);
  const sourceMap = new SourceMapGenerator({
    file: filename
  });
  sourceMap.setSourceContent(filename, source);
  const converted = generateJavaScript(ast, { sourceMap });
  // Embed sourcemap into code.
  const convertedCode = `${converted}//# sourceMappingURL=data:application/json;base64,${new Buffer(sourceMap.toString(), "utf8").toString("base64")}`;
  return convertedCode;
}
