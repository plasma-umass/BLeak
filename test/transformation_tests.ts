import {equal as assertEqual} from 'assert';
import {injectIntoHead, exposeClosureState} from '../src/lib/transformations';

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
      const newSource = exposeClosureState(source);
      // Super basic CommonJS shim.
      const exp: any = {};
      new Function('exports', newSource)(exp);
      return exp;
    }

    it('works with function declarations', function() {
      const module = instrumentModule<{decl: Function}>(`
        var a = 'hello';
        function decl(){}
        exports.decl = decl;
      `);
      assertEqual(module.decl.__closure__('a'), 'hello');
      assertEqual(module.decl.__closure__('decl'), module.decl);
    });

    it('works with function expressions', function() {
      const module = instrumentModule<{decl: Function}>(`
        var a = 'hello';
        exports.decl = function(){};
      `);
      assertEqual(module.decl.__closure__('a'), 'hello');
      assertEqual(module.decl.__closure__('exports').decl, module.decl);
    });

    it(`works with named function expressions`, function() {
      const module = instrumentModule<{decl: Function}>(`
        var a = 'hello';
        exports.decl = function decl2(){};
      `);
      assertEqual(module.decl.__closure__('a'), 'hello');
    });

    it(`works with multiple functions in the same block and multiple variables`, function() {
      const module = instrumentModule<{decl: Function, decl2: Function}>(`
        var a='hello';
        var b=3;
        exports.decl=function(){};
        exports.decl2=function(){};
      `);
      assertEqual(module.decl.__closure__('a'), 'hello');
      assertEqual(module.decl2.__closure__('a'), 'hello');
      assertEqual(module.decl.__closure__('b'), 3);
      assertEqual(module.decl.__closure__('b'), 3);
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
      assertEqual(module.decl.__closure__('a'), 'hello');
      assertEqual(module.notDecl.__closure__('a'), 'hello');
      assertEqual(module.notDecl().__closure__('a'), 'hello');
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
      assertEqual(module.decl.__closure__('a'), 'hello');
      assertEqual(module.notDecl.__closure__('a'), 'hello');
      assertEqual(module.notDecl().__closure__('a'), 'hello');
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
      assertEqual(module.obj.decl.__closure__('a'), 'hello');
      assertEqual(module.obj.decl2.__closure__('a'), 'hello');
    });
  });
});