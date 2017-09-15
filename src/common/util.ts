import {default as MITMProxy, getInterceptor} from '../lib/mitmproxy';
import {createConnection, Socket} from 'net';

export const DEFAULT_AGENT_PATH = require.resolve('../lib/bleak_agent');
export const DEFAULT_AGENT_URL = `/bleak_agent.js`;
export const DEFAULT_BABEL_POLYFILL_URL = `/bleak_polyfill.js`;
export const DEFAULT_BABEL_POLYFILL_PATH = require.resolve('babel-polyfill/dist/polyfill');

export function configureProxy(proxy: MITMProxy, diagnose: boolean, fixes: number[] = [], config = "", disableAllRewrites: boolean, rewriteFunction?: (url: string, type: string, data: Buffer, fixes: number[]) => Buffer): void {
  proxy.cb = getInterceptor(DEFAULT_AGENT_URL, DEFAULT_AGENT_PATH, DEFAULT_BABEL_POLYFILL_URL, DEFAULT_BABEL_POLYFILL_PATH, diagnose, config, fixes, disableAllRewrites, rewriteFunction);
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

export function waitForPort(port: number, retries: number = 10, interval: number = 500): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let retriesRemaining = retries;
    let retryInterval = interval;
    let timer: NodeJS.Timer = null;
    let socket: Socket = null;

    function clearTimerAndDestroySocket() {
      clearTimeout(timer);
      timer = null;
      if (socket) socket.destroy();
      socket = null;
    }

    function retry() {
      tryToConnect();
    }

    function tryToConnect() {
      clearTimerAndDestroySocket();

      if (--retriesRemaining < 0) {
        reject(new Error('out of retries'));
      }

      socket = createConnection(port, "localhost", function() {
        clearTimerAndDestroySocket();
        if (retriesRemaining >= 0) resolve();
      });

      timer = setTimeout(function() { retry(); }, retryInterval);

      socket.on('error', function(err) {
        clearTimerAndDestroySocket();
        setTimeout(retry, retryInterval);
      });
    }

    tryToConnect();
  });
}