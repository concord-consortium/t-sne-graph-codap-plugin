// Seeded random numbers, so the same data and seed always give the same t-SNE picture.

export type RandomFn = () => number;

// A new seed for mulberry32: a whole number in [0, 2^32)
export const randomSeed = () => Math.floor(Math.random() * 2 ** 32);

// mulberry32 is defined by 32-bit integer operations
/* eslint-disable no-bitwise */
/**
 * Returns a mulberry32 generator: numbers in [0, 1), the same sequence for the same seed.
 * Only the low 32 bits of the seed are used.
 */
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

/**
 * Returns a generator of normally distributed numbers (mean 0, standard deviation 1) drawn from
 * `random`. Uses the polar method, as tsnejs does: each pair of uniform numbers gives two results,
 * and the second is kept for the next call.
 */
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
        const c = Math.sqrt(-2 * Math.log(r) / r);
        saved = v * c;
        return u * c;
      }
    }
  };
};
