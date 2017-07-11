interface PromiseLike<T> {
  catch(cb: Function): PromiseLike<T>;
}

interface Function {
  __closure__(name: string): any;
  __closureAssign__(name: string, value: any): void;
}

interface Window {
  $$instrumentPaths(p: string[]): void;
  $$getStackTraces(): string;
  $$domObjects: any;
}