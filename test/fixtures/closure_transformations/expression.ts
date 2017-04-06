import {TestConfig} from '../../interfaces';

const config: TestConfig = {
  name: 'Works with function expressions',
  mods: [
    {
      source: `function(){}`,
      variables: ['a']
    }
  ],
  source: `var a='hello';var decl=function(){};`,
  transformed: `var a='hello';var decl=(function(){var __tmp__=function(){};__tmp__.__closure__={a:function(){return a;}};return __tmp__;}());`
};
export default config;