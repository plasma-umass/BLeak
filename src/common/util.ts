/**
 * Returns a function that will wrap the given `nodeFunction`. Instead of taking a callback, the returned function will return a promise whose fate is decided by the callback behavior of the given node function. The node function should conform to node.js convention of accepting a callback as last argument and calling that callback with error as the first argument and success value on the second argument.
 *
 * If the `nodeFunction` calls its callback with multiple success values, the fulfillment value will be an array of them.
 *
 * If you pass a `receiver`, the `nodeFunction` will be called as a method on the `receiver`.
 */
export function promisify<T>(thisArg: any, func: (callback: (err: any, result?: T) => void) => void): () => Promise<T>;
export function promisify<T, A1>(thisArg: any, func: (arg1: A1, callback: (err: any, result?: T) => void) => void): (arg1: A1) => Promise<T>;
export function promisify<T, A1, A2>(thisArg: any, func: (arg1: A1, arg2: A2, callback: (err: any, result?: T) => void) => void): (arg1: A1, arg2: A2) => Promise<T>;
export function promisify<T, A1, A2, A3>(thisArg: any, func: (arg1: A1, arg2: A2, arg3: A3, callback: (err: any, result?: T) => void) => void): (arg1: A1, arg2: A2, arg3: A3) => Promise<T>;
export function promisify<T, A1, A2, A3, A4>(thisArg: any, func: (arg1: A1, arg2: A2, arg3: A3, arg4: A4, callback: (err: any, result?: T) => void) => void): (arg1: A1, arg2: A2, arg3: A3, arg4: A4) => Promise<T>;
export function promisify<T, A1, A2, A3, A4, A5>(thisArg: any, func: (arg1: A1, arg2: A2, arg3: A3, arg4: A4, arg5: A5, callback: (err: any, result?: T) => void) => void): (arg1: A1, arg2: A2, arg3: A3, arg4: A4, arg5: A5) => Promise<T>;
export function promisify(thisArg: any, func: (arg1: any, arg2: any, arg3: any, arg4: any, arg5: any, arg6: any) => void): (arg1: any, arg2: any, arg3: any, arg4: any, arg5: any, arg6: any) => Promise<any> {
  return function(...args: any[]): Promise<any> {
    return new Promise<any>((res, rej) => {
      args.push(function(e: any, result: any): void {
        if (e) {
          rej(e);
        } else {
          res(result);
        }
      });
      func.apply(thisArg, args);
    });
  };
}

export function path2string(p: SerializeableGCPath): string {
  let rv = "";
  switch (p.root.type) {
    case RootType.DOM:
      rv = `<${p.root.elementType}>`;
      break;
    case RootType.GLOBAL:
      rv = `window`;
      break;
  }
  const path = p.path;
  for (const l of path) {
    switch (l.type) {
      case EdgeType.CLOSURE:
        rv += `.__closure__(${l.indexOrName})`;
        break;
      case EdgeType.INDEX:
        rv += `['${l.indexOrName}']`;
        break;
      case EdgeType.NAMED:
        rv += `.${l.indexOrName}`;
        break;
    }
  }
  return rv;
}