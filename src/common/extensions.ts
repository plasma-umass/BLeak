interface PromiseLike<T> {
  catch(cb: Function): PromiseLike<T>;
}

interface Function {
  __closure__(): {[name: string]: any};
}