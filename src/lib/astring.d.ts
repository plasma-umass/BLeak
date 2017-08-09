declare module "astring" {
  import {SourceMapGenerator} from 'source-map';
  import {Node} from 'estree';

  export function generate(node: Node, options: {
    indent?: string,
    lineEnd?: string,
    startingIndentLevel?: number,
    comments?: boolean,
    sourceMap?: SourceMapGenerator | null
  }): string;
}