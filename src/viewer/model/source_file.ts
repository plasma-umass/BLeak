import {FormatterSourceMapping} from './../formatter';

export default class SourceFile {
  constructor(
    public readonly url: string,
    public readonly source: string,
    public readonly formattedSource: string,
    public readonly mapping: FormatterSourceMapping) {}
}