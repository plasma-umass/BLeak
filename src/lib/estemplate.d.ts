declare module 'estemplate' {
  import {Node, Program} from 'estree';
  import {Options} from 'esprima';
  export function compile(tmplString: string, options?: Options): (vars: {[name: string]: Node | Node[]}) => Program;
}
