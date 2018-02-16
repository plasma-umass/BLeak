import {Log} from './interfaces';

export function time<T>(n: string, log: Log, action: () => T): T {
  const start = Date.now();
  const rv = action();
  const end = Date.now();
  const str = `Time to run ${n}: ${(end - start) / 1000} seconds.`;
  log.log(str);
  return rv;
}

export function wait(ms: number): Promise<void> {
  return new Promise<void>((res) => {
    setTimeout(res, ms);
  });
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
