import {equal as assertEqual} from 'assert';
import {injectIntoHead, exposeClosureState} from '../src/lib/transformations';
import {readFileSync} from 'fs';

const AGENT_SOURCE = readFileSync(require.resolve('../src/lib/deuterium_agent'), "utf8");

describe('Transformations', function() {
  describe('injectIntoHead', function() {
    const headTagTypes = [
      [`<head>`, `</head>`, 'is in lowercase'],
      [`<HEAD>`, `</HEAD>`, 'is in uppercase'],
      [`<heAd>`, `</HeAd>`, 'is in a mix of lower and uppercase'],
      [`< head >`, `</ head>`, 'has whitespace within tag'],
      [`<\n\thead\n\t>`, `</\n\thead>`, 'has newlines within tag'],
      [``, ``, 'is missing']
    ];

    headTagTypes.forEach((headTag) => {
      it(`should work when the head tag ${headTag[2]}`, function() {
        const source = `<!DOCTYPE html><html>${headTag[0]}${headTag[1]}</html>`;
        const injection = `hello`;
        const output = `<!DOCTYPE html><html>${headTag[0]}${injection}${headTag[1]}</html>`;
        assertEqual(injectIntoHead(source, injection), output);
      });
    });
  });

  describe('exposeClosureState', function() {
    function instrumentModule<T>(source: string): T {
      const newSource = exposeClosureState("main.js", source, true);
      // Super basic CommonJS shim.
      const exp: any = {};
      // console.log("Original Source:\n" + source);
      // console.log("\nNew Source:\n" + newSource);
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
  });
});