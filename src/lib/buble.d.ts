declare module 'buble' {
  import {RawSourceMap} from 'source-map';
  export function transform(source: string, opts?: { file?: string, source?: string }): { code: string, map: RawSourceMap };
}