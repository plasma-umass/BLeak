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

export function path2string(p: SerializeableGCPath, escapeForMarkdown: boolean = false): string {
  let rv = "";
  switch (p.root.type) {
    case RootType.DOM:
      if (escapeForMarkdown) {
        rv = `\<${p.root.elementType}\>`;
      } else {
        rv = `<${p.root.elementType}>`;
      }
      break;
    case RootType.GLOBAL:
      rv = `window`;
      break;
  }
  const path = p.path;
  for (const l of path) {
    switch (l.type) {
      case EdgeType.CLOSURE:
        if (escapeForMarkdown) {
          rv += `.\_\_closure\_\_(${l.indexOrName})`;
        } else {
          rv += `.__closure__(${l.indexOrName})`;
        }
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

export function time<T>(n: string, action: () => T, log?: (s: string) => void): T {
  const start = Date.now();
  const rv = action();
  const end = Date.now();
  const str = `Time to run ${n}: ${(end - start) / 1000} seconds.`;
  if (log) {
    log(str);
  } else {
    console.log(str);
  }
  return rv;
}

export class OneBitArray {
  private _bits: Uint8Array;
  constructor(length: number) {
    this._bits = new Uint8Array(Math.ceil(length / 8));
  }

  public set(i: number, v: boolean) {
    const index = i >> 3;
    const offset = i - (index << 3);
    const mask = (1 << offset);
    // Clear bit
    this._bits[index] &= ~mask;
    if (v) {
      // Set bit
      this._bits[index] |= mask;
    }
  }

  public get(i: number): boolean {
    const index = i >> 3;
    const offset = i - (index << 3);
    return (this._bits[index] & (1 << offset)) !== 0;
  }
}

export class TwoBitArray {
  private _bits: Uint8Array;
  constructor(length: number) {
    this._bits = new Uint8Array(Math.ceil(length / 4));
  }

  public fill(v: number): void {
    const vMasked = v & 0x3;
    const vQuad = (vMasked << 6) | (vMasked << 4) | (vMasked << 2) | vMasked;
    this._bits.fill(vQuad);
  }

  public set(i: number, v: number) {
    const index = i >> 2;
    const offset = (i - (index << 2)) << 1;
    const mask = 0x3 << offset;
    // Clear area
    this._bits[index] &= ~mask;
    // Set area
    this._bits[index] |= (v & 0x3) << offset;
  }

  public get(i: number): number {
    const index = i >> 2;
    const offset = (i - (index << 2)) << 1;
    const mask = 0x3 << offset;
    return (this._bits[index] & mask) >> offset;
  }
}

export class FourBitArray {
  private _bits: Uint8Array;
  constructor(length: number) {
    this._bits = new Uint8Array(Math.ceil(length / 2));
  }

  public fill(v: number): void {
    const vMasked = v & 0xF;
    const vDouble = (vMasked << 4) | vMasked;
    this._bits.fill(vDouble);
  }

  public set(i: number, v: number) {
    const index = i >> 1;
    const offset = i - (index << 1);
    if (offset === 1) {
      const newV = (v & 0xF) << 4;
      // Clear area
      this._bits[index] &= 0xF;
      // Set area
      this._bits[index] |= newV;
    } else {
      // Clear area
      this._bits[index] &= 0xF0;
      // Set area
      this._bits[index] |= (v & 0xF);
    }
  }

  public get(i: number): number {
    const index = i >> 1;
    const offset = i - (index << 1);
    return offset === 1 ? (this._bits[index] >> 4) : this._bits[index] & 0xF;
  }
}