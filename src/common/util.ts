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