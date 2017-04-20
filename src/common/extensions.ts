interface PromiseLike<T> {
  catch(cb: Function): PromiseLike<T>;
}

interface Function {
  __closure__(name: string): any;
}

interface Window {
  $$instrumentPaths(p: string[]): void;
  $$getStackTraces(): string;
}