import {TestConfig} from '../../interfaces';

const config: TestConfig = {
  name: 'works with named function expressions',
  mods: [
    {
      source: `function decl2(){}`,
      variables: ['a']
    }
  ],
  source: `var a='hello';var decl=function decl2(){};`,
  transformed: `var a='hello';var decl=(function(){var __tmp__=function decl2(){};__tmp__.__closure__={a:function(){return a;}};return __tmp__;}());`
};
export default config;