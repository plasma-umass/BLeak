import {equal as assertEqual} from 'assert';
import {injectIntoHead, exposeClosureState, parseHTML} from '../src/lib/transformations';
import {readFileSync} from 'fs';

const AGENT_SOURCE = readFileSync(require.resolve('../src/lib/bleak_agent'), "utf8");

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
      const newSource = exposeClosureState("main.js", `(function(exports) { ${source} })(exports);`, true);
      // Super basic CommonJS shim.
      const exp: any = {};
      //console.log("Original Source:\n" + source);
      //console.log("\nNew Source:\n" + newSource);
      new Function('exports', AGENT_SOURCE + "\n" + newSource)(exp);
      return exp;
    }

    it('works with function declarations', function() {
      const module = instrumentModule<{decl: Function}>(`
        var a = 'hello';
        function decl(){}
        exports.decl = decl;
      `);
      assertEqual(module.decl.__scope__['a'], 'hello');
      assertEqual(module.decl.__scope__['decl'], module.decl);
      module.decl.__scope__['a'] = 'no';
      assertEqual(module.decl.__scope__['a'], 'no');
      const arr = [1,2,3];
      module.decl.__scope__['a'] = arr;
      assertEqual(module.decl.__scope__['a'], arr);
    });

    it('works with function expressions', function() {
      const module = instrumentModule<{decl: Function}>(`
        var a = 'hello';
        exports.decl = function(){};
      `);
      assertEqual(module.decl.__scope__['a'], 'hello');
      assertEqual(module.decl.__scope__['exports'].decl, module.decl);
    });

    it(`works with named function expressions`, function() {
      const module = instrumentModule<{decl: Function}>(`
        var a = 'hello';
        exports.decl = function decl2(){};
      `);
      assertEqual(module.decl.__scope__['a'], 'hello');
    });

    it(`works with multiple functions in the same block and multiple variables`, function() {
      const module = instrumentModule<{decl: Function, decl2: Function}>(`
        var a='hello';
        var b=3;
        exports.decl=function(){};
        exports.decl2=function(){};
      `);
      assertEqual(module.decl.__scope__['a'], 'hello');
      assertEqual(module.decl2.__scope__['a'], 'hello');
      assertEqual(module.decl.__scope__['b'], 3);
      assertEqual(module.decl.__scope__['b'], 3);
    });

    it(`works with nested functions`, function() {
      const module = instrumentModule<{decl: Function, notDecl: Function}>(`
        var a = 'hello';
        function decl(){}
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
        function decl(){}
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
          decl: function() {},
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
            return a;
          }
        };
      `);
      assertEqual(module.obj.decl(0, [0,1,2]), 3);
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
  });
  // NEED A SWITCH CASE VERSION where it's not within a block!!!
});