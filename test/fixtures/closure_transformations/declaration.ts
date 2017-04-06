import {TestConfig} from '../../interfaces';

const config: TestConfig = {
  name: 'works with function declarations',
  mods: [
    {
      source: `function decl(){}`,
      variables: ['a']
    }
  ],
  source: `var a='hello';function decl(){}`,
  transformed: `decl.__closure__={a:function(){return a;}};var a='hello';function decl(){}`
};
export default config;
