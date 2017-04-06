import {TestConfig} from '../../interfaces';

const config: TestConfig = {
  name: 'works with nested functions',
  mods: [
    {
      source: `function decl(){}`,
      variables: ['a']
    }
  ],
  source: `var a='hello';function decl(){}function notDecl(){var decl=function decl(){};}`,
  transformed: `decl.__closure__={a:function(){return a;}};var a='hello';function decl(){}function notDecl(){var decl=(function(){var __tmp__=function decl(){};__tmp__.__closure__={a:function(){return a;}};return __tmp__;}());}`
};
export default config;