import {TestConfig} from '../../interfaces';

const config: TestConfig = {
  name: 'works when there are no applicable modifications to be made',
  mods: [
    {
      source: `function decl(){   }`,
      variables: ['a']
    }
  ],
  source: `var a='hello';function decl(){}`,
  transformed: `var a='hello';function decl(){}`
};
export default config;