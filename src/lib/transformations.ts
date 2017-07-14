import {parse as parseJavaScript} from 'esprima';
import {replace as rewriteJavaScript} from 'estraverse';
import {generate as generateJavaScript} from 'escodegen';
import {compile} from 'estemplate';
import {Node, BlockStatement, Program, ExpressionStatement, CallExpression, AssignmentExpression, Statement, MemberExpression, Identifier, FunctionDeclaration, FunctionExpression, Literal} from 'estree';

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
const SCOPE_ASSIGNMENT_EXPRESSION_STR = `<%= functionVarName %>.__scope__ = <%= scopeVarName %>;`;
const EXPRESSION_TRANSFORM_TEMPLATE = compile(`(function(){var <%= functionVarName %>=<%= originalFunction %>;${SCOPE_ASSIGNMENT_EXPRESSION_STR}return <%= functionVarName %>;}())`);
function getExpressionTransform(functionVarName: Identifier, originalFunction: FunctionExpression, scopeVarName: Identifier): CallExpression {
  const prog = EXPRESSION_TRANSFORM_TEMPLATE({
    functionVarName,
    originalFunction,
    scopeVarName
  });
  return <CallExpression> (<ExpressionStatement> prog.body[0]).expression;
}

const SCOPE_ASSIGNMENT_TEMPLATE = compile(SCOPE_ASSIGNMENT_EXPRESSION_STR);
function getScopeAssignment(functionVarName: Identifier, scopeVarName: Identifier): ExpressionStatement {
  const prog = SCOPE_ASSIGNMENT_TEMPLATE({
    functionVarName,
    scopeVarName
  });
  return <ExpressionStatement> prog.body[0];
}

const SCOPE_PROPERTY_TEMPLATE = compile(`Object.defineProperty(<%= scopeVarName %>, <%= propName %>, {
  get: function() {
    return scope[<%= mappedPropName %>];
  },
  set: function(val) {
    if (scope["1interceptMap"] !== null && scope["1interceptMap"].has(<%= propName %>)) {
      var map = scope["1map"];
      $$addStackTrace(map, <%= propName %>);
      if (val !== null && typeof(val) === "object") {
        scope[<%= mappedPropName %>] = $$getProxy(val, map);
      } else {
        scope[<%= mappedPropName %>] = val;
      }
    } else {
      scope[<%= mappedPropName %>] = val;
    }
  }
});
scope[<%= mappedPropName %>] = null;`);
function getScopePropertyAssignment(scopeVarName: Identifier, propName: Literal, mappedPropName: Literal): Node[] {
  const prog = SCOPE_PROPERTY_TEMPLATE({
    scopeVarName,
    propName,
    mappedPropName
  });
  return prog.body;
}

const SCOPE_UNMOVED_PROPERTY_TEMPLATE = compile(`Object.defineProperty(<%= scopeVarName %>, <%= propNameLiteral %>, {
  get: function() {
    return <%= propName %>;
  },
  set: function(val) {
    <%= propName %> = val;
  }
});`);
function getScopeUnmovedPropertyAssignment(scopeVarName: Identifier, propName: string): Node[] {
  const prog = SCOPE_UNMOVED_PROPERTY_TEMPLATE({
    scopeVarName: scopeVarName,
    propNameLiteral: {
      type: "Literal",
      value: propName,
      raw: propName
    },
    propName: {
      type: "Identifier",
      name: propName
    }
  });
  return prog.body;
}

const SCOPE_VARIABLE_DECLARATION = compile(`var <%= scopeVarName %> = Object.create(<%= parentScopeVarName %>);
<%= scopeVarName %>["1interceptMap"] = null;
<%= scopeVarName %>["1map"] = null;
<%= scopeVarName %>["1INTERCEPT_VAR_ASSIGNMENT"] = function(name, map) {
  if (!<%= scopeVarName %>.hasOwnProperty("0" + name)) {
    // Forward to parent scope.
    if (<%= parentScopeVarName %>["1INTERCEPT_VAR_ASSIGNMENT"]) {
      return <%= parentScopeVarName %>["1INTERCEPT_VAR_ASSIGNMENT"](name, map);
    } else {
      return false;
    }
  } else {
    <%= scopeVarName %>["1map"] = map;
    if (<%= scopeVarName %>["1interceptMap"] === null) {
      <%= scopeVarName %>["1interceptMap"] = new Set();
    }
    <%= scopeVarName %>["1interceptMap"].add(name);
  }
  return true;
};`);

function getScopeDefinition(scope: Scope): Statement[] {
  if (!scope.closedOver) {
    throw new Error(`Cannot produce scope definition for non closed over scope.`);
  }
  const movedIdentifiers = scope.getMovedIdentifiers();
  const unmovedIdentifiers = scope.getUnmovedIdentifiers();
  const scopeVarName = scope.scopeIdentifier;
  const scopeVarIdent: Identifier = {
    type: "Identifier",
    name: scopeVarName
  };
  const modifications: Node[] = SCOPE_VARIABLE_DECLARATION({
    scopeVarName: scopeVarIdent,
    parentScopeVarName: {
      type: "Identifier",
      name: scope.parent.scopeIdentifier
    }
  }).body;
  movedIdentifiers.forEach((identifier: string) => {
    const mappedIdent = `0${identifier}`;
    Array.prototype.push.apply(modifications, getScopePropertyAssignment(scopeVarIdent, {
      type: "Literal",
      value: identifier,
      raw: identifier
    }, {
      type: "Literal",
      value: mappedIdent,
      raw: mappedIdent
    }));
  });
  unmovedIdentifiers.forEach((identifier: string) => {
    Array.prototype.push.apply(modifications, getScopeUnmovedPropertyAssignment(scopeVarIdent, identifier));
  });
  return <Statement[]> modifications;
}

function assignArgumentsToScopeObject(fcn: FunctionDeclaration | FunctionExpression, scope: Scope): Statement[] {
  const name = scope.scopeIdentifier;
  const js = fcn.params.map((p) => p.type === "Identifier" ? `${name}.${p.name} = ${p.name};` : ``).join("\n");
  return <Statement[]> parseJavaScript(js).body;
}

class Scope {
  protected _identifiers = new Map<string, boolean>();
  public readonly parent: Scope;
  private _scopeIdentifier: string = null;
  private _closedOver: boolean = false;
  constructor(parent: Scope) {
    this.parent = parent;
  }

  /**
   * Add an identifier to the scope.
   * @param identifier The identifier to add to the scope.
   * @param unmoved If true, the identifier will not be moved into a scope object.
   */
  public add(identifier: string, unmoved: boolean): void {
    this._identifiers.set(identifier, unmoved);
  }

  /**
   * Find the scope that contains the given identifier.
   * @param identifier
   */
  public lookup(identifier: string): Scope {
    if (this._identifiers.has(identifier)) {
      return this;
    } else {
      return this.parent.lookup(identifier);
    }
  }

  /**
   * Get the new location for the given identifier.
   * Performs lookup.
   * @param identifier
   */
  public getReplacement(identifier: Identifier): Identifier | MemberExpression {
    if (this._identifiers.has(identifier.name)) {
      const unmoved = this._identifiers.get(identifier.name);
      if (unmoved) {
        return identifier;
      } else {
        return {
          type: "MemberExpression",
          computed: false,
          object: {
            type: "Identifier",
            name: this.scopeIdentifier
          },
          property: {
            type: "Identifier",
            name: identifier.name
          },
          loc: identifier.loc
        };
      }
    } else {
      return this.parent.getReplacement(identifier);
    }
  }

  public getMovedIdentifiers(): string[] {
    const rv = new Array<string>();
    this._identifiers.forEach((unmoved, identifier) => {
      if (!unmoved) {
        rv.push(identifier);
      }
    });
    return rv;
  }

  public getUnmovedIdentifiers(): string[] {
    const rv = new Array<string>();
    this._identifiers.forEach((unmoved, identifier) => {
      if (unmoved) {
        rv.push(identifier);
      }
    });
    return rv;
  }

  public finalize(): void {
    const base = "scope";
    let varName = base;
    let count = 0;
    while (this.lookup(varName) !== null) {
      varName = `${base}${count}`;
      count++;
    }
    this._scopeIdentifier = varName;
    // Add self as unmoved identifier.
    this._identifiers.set(this._scopeIdentifier, true);
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
  constructor() {
    super(null);
  }

  public getReplacement(identifier: Identifier): Identifier {
    return identifier;
  }

  public getMovedIdentifiers(): string[] {
    return [];
  }

  public getUnmovedIdentifiers(): string[] {
    return [];
  }

  public lookup(identifier: string): Scope {
    if (this._identifiers.has(identifier)) {
      return this;
    }
    return null;
  }

  public get scopeIdentifier(): string {
    return "global";
  }
}

/**
 * Given a JavaScript source file, modifies all function declarations and expressions to expose
 * their closure state on the function object.
 *
 * @param source Source of the JavaScript file.
 */
export function exposeClosureState(filename: string, source: string): string {
  let ast = parseJavaScript(source, { loc: true });

  let scope: Scope = new GlobalScope();
  let scopeMap = new Map<FunctionDeclaration | FunctionExpression, Scope>();

  function enterFunction(fcn: FunctionExpression | FunctionDeclaration) {
    scope.markAsClosedOver();
    scope = new Scope(scope);
    scopeMap.set(fcn, scope);
    fcn.params.forEach((p) => {
      if (p.type === "Identifier") {
        scope.add(p.name, false);
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
      switch(node.type) {
        case 'VariableDeclaration': {
          const decls = node.declarations;
          decls.forEach((d) => {
            const id = d.id;
            if (id.type === "Identifier") {
              scope.add(id.name, false);
            }
          });
          break;
        }
        case 'FunctionDeclaration': {
          const name = node.id;
          // Function name
          if (name.type === "Identifier") {
            scope.add(name.name, true);
          }
          enterFunction(node);
          break;
        }
        case 'FunctionExpression': {
          enterFunction(node);
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
        case 'ArrowFunctionExpression':
          throw new Error(`Arrow functions not yet supported.`);
      }
      return undefined;
    }
  });

  console.log("Scopes decided.");

  // Finalize scopes.
  scopeMap.forEach((s) => s.finalize());

  console.log("Scopes finalized.");

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
      switch (node.type) {
        case 'Identifier': {
          if (scope.closedOver && (!parent || (parent.type !== "FunctionDeclaration" && parent.type !== "FunctionExpression"))) {
            return scope.getReplacement(node);
          }
          return node;
        }
        case 'VariableDeclaration': {
          if (scope instanceof GlobalScope || !scope.closedOver) {
            return node;
          }
          //console.log("Leaving VD");
          // Remove if no initialization.
          // If initialized, though, change into an assignment.
          return <BlockStatement> {
            type: "BlockStatement",
            body: <Node[]> node.declarations.map((decl) => {
              if (!decl.init) {
                return null;
              }
              return <AssignmentExpression> {
                type: "AssignmentExpression",
                operator: "=",
                left: decl.id,
                right: decl.init,
                loc: decl.loc
              };
            }).filter((assgn) => assgn !== null)
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
          //console.log("Leaving FE");
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
              node.body = getScopeDefinition(scope).concat(assignArgumentsToScopeObject(parent, scope)).concat(node.body);
            }
          }
          return node;
      }
      return undefined;
    }
  });

  if (blockInsertions.length > 0) {
    const body = (<Program> newAst).body;
    body.unshift.apply(body, blockInsertions);
  }
  console.log("Finished second phase.");
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