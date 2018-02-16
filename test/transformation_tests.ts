import {equal as assertEqual, notEqual as assertNotEqual} from 'assert';
import {exposeClosureState, injectIntoHead, parseHTML} from '../src/lib/transformations';
import {DEFAULT_AGENT_URL, DEFAULT_BABEL_POLYFILL_URL} from '../src/lib/mitmproxy_interceptor';
import {readFileSync} from 'fs';

const AGENT_SOURCE = readFileSync(require.resolve('../src/lib/bleak_agent'), "utf8");

/**
 * An XMLHttpRequest mock, passed to the BLeak agent so it can support programs with eval.
 * Mirrors the behavior of the proxy when the /eval URL is requested.
 */
class XHRShim {
  public responseText: string = null;
  public open() {}
  public setRequestHeader() {}
  public send(data: string) {
    const d: { scope: string, source: string } = JSON.parse(data);
    this.responseText = exposeClosureState(`eval-${Math.random()}.js`, d.source, DEFAULT_AGENT_URL, DEFAULT_BABEL_POLYFILL_URL, d.scope);
  }
}

describe('Transformations', function() {
  describe('injectIntoHead', function() {
    const headTagTypes = [
      [`<head>`, `</head>`, 'is in lowercase'],
      [`<HEAD>`, `</HEAD>`, 'is in uppercase'],
      [`<heAd>`, `</heAd>`, 'is in a mix of lower and uppercase'],
      [``, ``, 'is missing']
    ];
    const rawInjection = `<script>hello</script>`;
    const injection = parseHTML(rawInjection);
    headTagTypes.forEach((headTag) => {
      it(`should work when the head tag ${headTag[2]}`, function() {
        const source = `<!DOCTYPE html><html>${headTag[0]}${headTag[1]}</html>`;
        const output = `<!DOCTYPE html><html>${headTag[0]}${rawInjection}${headTag[1]}</html>`;
        assertEqual(injectIntoHead("test.html", source, injection), output);
      });
    });
  });

  describe(`Inline JavaScript`, function() {
    it(`should rewrite inline JavaScript`, function() {
      const source = `<html><head><script type="text/javascript">
      function foo() {

      }
      </script></head></html>`;
      const expected = `<html><head><script type="text/javascript">NO</script></head></html>`;
      assertEqual(injectIntoHead("test.html", source, [], () => "NO"), expected);
    });
  });

  describe('exposeClosureState', function() {
    function instrumentModule<T>(source: string): T {
      const newSource = exposeClosureState("main.js", `(function(exports) { ${source} })(exports);`);
      // Super basic CommonJS shim.
      const exp: any = {};
      new Function('exports', 'XMLHttpRequest', AGENT_SOURCE + "\n" + newSource)(exp, XHRShim);
      return exp;
    }

    it('works with function declarations', function() {
      const module = instrumentModule<{decl: Function}>(`
        var a = 'hello';
        var b = 'hello';
        function decl(){ if (false) { decl(); } return a; }
        exports.decl = decl;
      `);
      assertEqual(module.decl.__scope__['a'], 'hello');
      assertEqual(module.decl.__scope__['decl'], module.decl);
      // b isn't closed over.
      assertEqual(module.decl.__scope__['b'], undefined);
      module.decl.__scope__['a'] = 'no';
      assertEqual(module.decl.__scope__['a'], 'no');
      const arr = [1,2,3];
      module.decl.__scope__['a'] = arr;
      assertEqual(module.decl(), arr);
    });

    it('works with function expressions', function() {
      const module = instrumentModule<{decl: Function}>(`
        var a = 'hello';
        exports.decl = function(){ if (exports) {} return a; };
      `);
      assertEqual(module.decl.__scope__['a'], 'hello');
      assertEqual(module.decl.__scope__['exports'].decl, module.decl);
    });

    it(`works with named function expressions`, function() {
      const module = instrumentModule<{decl: Function}>(`
        var a = 'hello';
        exports.decl = function decl2(){ return a; };
      `);
      assertEqual(module.decl.__scope__['a'], 'hello');
    });

    it(`works with multiple functions in the same block and multiple variables`, function() {
      const module = instrumentModule<{decl: Function, decl2: Function}>(`
        var a='hello';
        var b=3;
        exports.decl=function(){ return a + b; };
        exports.decl2=function(){ return a + b; };
      `);
      assertEqual(module.decl.__scope__['a'], 'hello');
      assertEqual(module.decl2.__scope__['a'], 'hello');
      assertEqual(module.decl.__scope__['b'], 3);
      assertEqual(module.decl.__scope__['b'], 3);
    });

    it(`works with nested functions`, function() {
      const module = instrumentModule<{decl: Function, notDecl: Function}>(`
        var a = 'hello';
        function decl(){ return a; }
        function notDecl(){
          var decl = function decl(){};
          return decl;
        }
        exports.decl = decl;
        exports.notDecl = notDecl;
      `);
      assertEqual(module.decl.__scope__['a'], 'hello');
      assertEqual(module.notDecl.__scope__['a'], 'hello');
      assertEqual(module.notDecl().__scope__['a'], 'hello');
    });

    it(`works with nested function declarations`, function() {
      const module = instrumentModule<{decl: Function, notDecl: Function}>(`
        var a = 'hello';
        function decl(){ return a; }
        function notDecl(){
          function decl(){}
          return decl;
        }
        exports.decl = decl;
        exports.notDecl = notDecl;
      `)
      assertEqual(module.decl.__scope__['a'], 'hello');
      assertEqual(module.notDecl.__scope__['a'], 'hello');
      assertEqual(module.notDecl().__scope__['a'], 'hello');
    });

    it(`works with functions in a list`, function() {
      const module = instrumentModule<{obj: {decl: Function, decl2: Function}}>(`
        var a = 'hello';
        exports.obj = {
          decl: function() { return a; },
          decl2: function() {
            return 3
          }
        };
      `);
      assertEqual(module.obj.decl.__scope__['a'], 'hello');
      assertEqual(module.obj.decl2.__scope__['a'], 'hello');
    });

    it(`works with initializer lists in for loops`, function() {
      const module = instrumentModule<{obj: {decl: Function}}>(`
        exports.obj = {
          decl: function(a, b) {
            for (var i = 0, j = 0; i < b.length; i++) {
              j++;
              a += j;
            }
            return a;
          }
        };
      `);
      assertEqual(module.obj.decl(0, [0,1,2]), 6);
    });

    it(`works with initializers in for of loops`, function() {
      const module = instrumentModule<{obj: {decl: Function}}>(`
        exports.obj = {
          decl: function(a, b) {
            for (var prop of b) {
              if (b.hasOwnProperty(prop)) {
                a += parseInt(prop, 10);
              }
            }
            // Make sure prop doesn't escape.
            return function() {
              return [prop, a];
            };
          }
        };
      `);
      assertEqual(module.obj.decl(0, [0,1,2])()[1], 3);
    });

    it(`works with initializers in for in loops`, function() {
      const module = instrumentModule<{obj: {decl: Function}}>(`
        exports.b = [0,1,2];
        exports.obj = {
          decl: function(a) {
            for (var prop in exports.b) a += prop;
            prop = "hello";
            // Make sure prop escapes.
            return function() {
              return prop;
            };
          }
        };
      `);
      assertEqual(module.obj.decl("")(), "hello");
    });

    it(`works with catch clauses`, function() {
      const module = instrumentModule<{obj: {decl: Function}}>(`
        var err, e;
        exports.obj = {
          decl: function() {
            try { throw new Error("Hello"); } catch (e) { err = e; }
          }
        };
      `);
      module.obj.decl();
      assertEqual(module.obj.decl.__scope__['err'].message, "Hello");
    });

    it(`works with object literals`, function() {
      const module = instrumentModule<{obj: {decl: Function}}>(`
        var e = 5;
        exports.obj = {
          decl: function() {
            return { e: e };
          }
        };
      `);
      assertEqual(module.obj.decl().e, 5);
    });

    it(`works with computed properties`, function() {
      const module = instrumentModule<{obj: {decl: Function}}>(`
        var e = 0;
        exports.obj = {
          decl: function() {
            return arguments[e];
          }
        };
      `);
      assertEqual(module.obj.decl(100), 100);
    });

    it(`works with named function expressions`, function() {
      const module = instrumentModule<{obj: {decl: Function}}>(`
        var e = 0;
        exports.obj = {
          decl: function() {
            return function e(i) {
              return i === 0 ? 5 : e(i - 1);
            };
          }
        };
      `);
      assertEqual(module.obj.decl()(3), 5);
    });

    it(`does not change value of this`, function() {
      const module = instrumentModule<{obj: {decl: Function}}>(`
        var e = function() { return this; };
        exports.obj = {
          decl: function() {
            return e();
          }
        };
      `);
      assertEqual(module.obj.decl(), global);
    });

    it(`keeps strict mode declaration`, function() {
      const module = instrumentModule<{obj: {decl: Function}}>(`
        var e = function() { "use strict"; return this; };
        exports.obj = {
          decl: function() {
            return e();
          }
        };
      `);
      assertEqual(module.obj.decl(), undefined);
    });

    it(`updates arguments`, function() {
      const module = instrumentModule<{obj: {decl: Function}}>(`
        exports.obj = {
          decl: function(e) {
            e = 4;
            return arguments[0];
          }
        };
      `);
      assertEqual(module.obj.decl(100), 4);
    });

    it(`works on functions illegally defined in blocks`, function() {
      const module = instrumentModule<{obj: {decl: Function}}>(`
        exports.obj = {
          decl: function() {
            if (1) {
              function Z() {
                var a = 4;
                return function() { return a; };
              }
              return Z;
            }
          }
        };
      `);
      assertEqual(module.obj.decl()()(), 4);
    });

    it(`works on functions illegally defined in switch cases`, function() {
      const module = instrumentModule<{obj: {decl: Function}}>(`
        exports.obj = {
          decl: function(s) {
            switch (s) {
              case 1:
                function Z() {
                  var a = 4;
                  return function() { return a; };
                }
                return Z;
            }
          }
        };
      `);
      assertEqual(module.obj.decl(1)()(), 4);
    });

    it(`works on function expressions with names`, function() {
      const module = instrumentModule<{obj: Function}>(`
        exports.obj = function s() {
          s = 4;
          return s;
        };
      `);
      assertEqual(module.obj(), module.obj);
    });

    it(`makes proxy objects equal to original objects`, function() {
      const module = instrumentModule<{obj: Function, cmp: (a: any) => boolean}>(`
        global.a = {};
        exports.obj = function () {
          return a;
        };
        exports.cmp = function(b) {
          return a === b;
        };
      `);
      const a = module.obj();
      (<Window> <any> global).$$$INSTRUMENT_PATHS$$$([{
        id: 1,
        isGrowing: true,
        indexOrName: "a",
        type: PathSegmentType.PROPERTY,
        children: []
      }]);
      assertNotEqual(module.obj(), a, `Proxy for global variable 'a' is properly installed`);
      assertEqual(module.cmp(a), true, `a === Proxy(a)`);
      assertEqual(module.cmp(module.obj()), true, `Proxy(a) === Proxy(a)`);
    });

    it(`works with null array entry`, function() {
      const module = instrumentModule<{obj: (number | null)[]}>(`exports.obj = [,1,2];`);
      assertEqual(module.obj[0], null);
    });

    it(`works with computed properties`, function() {
      const module = instrumentModule<{fcn: () => number}>(`
        var a = "hello";
        var obj = { hello: 3 };
        exports.fcn = function() {
          return obj[a];
        };`);

        assertEqual(module.fcn(), 3);
        assertEqual(module.fcn.__scope__.a, "hello");
    });

    it(`works with arguments that do not escape`, function() {
      const module = instrumentModule<{fcn: (a: number) => number}>(`
        exports.fcn = function(a) {
          return a
        };`);
      assertEqual(module.fcn(3), 3);
    });

    it(`works with arguments that escape`, function() {
      const module = instrumentModule<{fcn: (a: number) => () => number}>(`
        exports.fcn = function(a) {
          return function() { return a; };
        };`);
      assertEqual(module.fcn(3)(), 3);
    });

    it(`moves all heap objects when eval is used`, function() {
      const module = instrumentModule<{fcn: (a: string) => any}>(`
        var secret = 3;
        exports.fcn = function(a) {
          return eval(a);
        };`);
      assertEqual(module.fcn("secret"), 3);
      assertEqual(module.fcn.__scope__.secret, 3);
      assertEqual(module.fcn("a"), "a");
    });

    it(`appropriately overwrites variables when eval is used`, function() {
      const module = instrumentModule<{fcn: (a: string) => any}>(`
        global.secret = 3;
        exports.fcn = function(a) {
          return eval(a);
        };`);
      assertEqual(module.fcn.__scope__.secret, 3);
      assertEqual((<any> global).secret, 3);
      (<any> global).secret = 4;
      assertEqual(module.fcn.__scope__.secret, 4);
      module.fcn("secret = 6");
      assertEqual(module.fcn.__scope__.secret, 6);
      assertEqual((<any> global).secret, 6);
    });

    it(`works with with()`, function() {
      const module = instrumentModule<{fcn: () => any, assign: (v: any) => any}>(`
        var l = 3;
        var o = { l: 5 };
        exports.fcn = function() {
          with(o) {
            return l;
          }
        };
        exports.assign = function(v) {
          with(o) { l = v; return l; }
        };`);
      assertEqual(module.fcn(), 5);
      assertEqual(module.assign(7), 7);
      assertEqual(module.fcn(), 7);
    });

    // instrument a global variable and get stack traces
    // with() with undefined / null / zeroish values.

    // growing paths: set up such that it has two separate custom setters!

    // growing window?

    // cycle of growing objects??

    // getters/setters

    // template literal

    // arrow functions, with `this` as the leaking object. arrow has only ref.
    // multiple object patterns that reference each other, e.g.:
    // var {a, b, c} = foo, {d=a} = bar;

    // a leak in a getter, e.g. { get foo() { var a;  return function() { } }}
    // or actually more like { get foo() { bar[random] = 3; }}
    // ==> Shows up as `get foo`!! Instrument both `foo` and `get foo`.
  });
  // NEED A SWITCH CASE VERSION where it's not within a block!!!
});