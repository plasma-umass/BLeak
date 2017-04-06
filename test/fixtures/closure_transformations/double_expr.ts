import {TestConfig} from '../../interfaces';

const config: TestConfig = {
  name: 'works with multiple functions in same block and multiple variables',
  mods: [
    {
      source: `function(){}`,
      variables: ['a','b']
    }
  ],
  source: `var a='hello';var b=3;var decl=function(){};var decl2=function(){};`,
  transformed: `var a='hello';var b=3;var decl=(function(){var __tmp__=function(){};__tmp__.__closure__={a:function(){return a;},b:function(){return b;}};return __tmp__;}());var decl2=(function(){var __tmp__=function(){};__tmp__.__closure__={a:function(){return a;},b:function(){return b;}};return __tmp__;}());`
};
export default config;