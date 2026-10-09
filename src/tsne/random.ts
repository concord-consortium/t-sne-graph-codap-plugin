import { log } from "./portable-math";

export type RandomFn = () => number;

export const randomSeed = () => Math.floor(Math.random() * 2 ** 32);

/* eslint-disable no-bitwise */
/** Uses only the seed's low 32 bits. */
export const mulberry32 = (seed: number): RandomFn => {
  let state = seed | 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), state | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};
/* eslint-enable no-bitwise */

/** Standard normal values by the polar method, as in tsnejs: each pair of draws gives two. */
export const gaussian = (random: RandomFn): RandomFn => {
  let saved: number | undefined;
  return () => {
    if (saved !== undefined) {
      const result = saved;
      saved = undefined;
      return result;
    }
    for (;;) {
      const u = 2 * random() - 1;
      const v = 2 * random() - 1;
      const r = u * u + v * v;
      if (r > 0 && r <= 1) {
        const c = Math.sqrt(-2 * log(r) / r);
        saved = v * c;
        return u * c;
      }
    }
  };
};
