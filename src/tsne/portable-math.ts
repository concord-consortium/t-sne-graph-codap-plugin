// exp and log that match to the last bit in every engine. Math.exp and Math.log can differ in the
// last bit between engines, and t-SNE grows that into a different layout. Ports of fdlibm's
// e_exp.c and e_log.c, using only + - * / (exactly rounded under IEEE 754) and exact bit access;
// within one unit in the last place.
//
// fdlibm notice: Copyright (C) 1993 by Sun Microsystems, Inc. All rights reserved. Developed at
// SunSoft, a Sun Microsystems, Inc. business. Permission to use, copy, modify, and distribute this
// software is freely granted, provided that this notice is preserved.

const view = new DataView(new ArrayBuffer(8));
const highWord = (x: number) => {
  view.setFloat64(0, x);
  return view.getInt32(0);
};
const lowWord = (x: number) => {
  view.setFloat64(0, x);
  return view.getUint32(4);
};
const withHighWord = (x: number, high: number) => {
  view.setFloat64(0, x);
  view.setInt32(0, high);
  return view.getFloat64(0);
};
// For -1022 <= k <= 1023
const powerOfTwo = (k: number) => {
  view.setUint32(0, (k + 1023) * 0x100000);
  view.setUint32(4, 0);
  return view.getFloat64(0);
};

const kLn2Hi = 6.93147180369123816490e-01;
const kLn2Lo = 1.90821492927058770002e-10;
const kInvLn2 = 1.44269504088896338700e+00;
const kExpOverflow = 7.09782712893383973096e+02;
const kExpUnderflow = -7.45133219101941108420e+02;
const kTwoToMinus1000 = 9.33263618503218878990e-302;
const kP1 = 1.66666666666666019037e-01;
const kP2 = -2.77777777770155933842e-03;
const kP3 = 6.61375632143793436117e-05;
const kP4 = -1.65339022054652515390e-06;
const kP5 = 4.13813679705723846039e-08;

/* eslint-disable no-bitwise -- the algorithms work on the bits of the number */

/** Port of fdlibm e_exp.c. */
export const exp = (x: number): number => {
  const signBit = highWord(x) >>> 31;
  const hx = highWord(x) & 0x7fffffff;

  // |x| >= 709.78, or not finite
  if (hx >= 0x40862e42) {
    if (hx >= 0x7ff00000) {
      if (((hx & 0xfffff) | lowWord(x)) !== 0) return x + x;   // NaN
      return signBit === 0 ? x : 0;                               // exp(+-Infinity)
    }
    if (x > kExpOverflow) return Infinity;
    if (x < kExpUnderflow) return 0;
  }

  // Reduce to r = x - k ln2, |r| <= 0.5 ln2, as hi - lo
  let hi = 0;
  let lo = 0;
  let k = 0;
  if (hx > 0x3fd62e42) {
    if (hx < 0x3ff0a2b2) {
      hi = x - (signBit === 0 ? kLn2Hi : -kLn2Hi);
      lo = signBit === 0 ? kLn2Lo : -kLn2Lo;
      k = 1 - signBit - signBit;
    } else {
      k = Math.trunc(kInvLn2 * x + (signBit === 0 ? 0.5 : -0.5));
      hi = x - k * kLn2Hi;
      lo = k * kLn2Lo;
    }
    x = hi - lo;
  } else if (hx < 0x3e300000) {
    // |x| < 2^-28
    return 1 + x;
  }

  // Rational approximation of exp(r)
  const t = x * x;
  const c = x - t * (kP1 + t * (kP2 + t * (kP3 + t * (kP4 + t * kP5))));
  if (k === 0) return 1 - ((x * c) / (c - 2) - x);
  const y = 1 - ((lo - (x * c) / (2 - c)) - hi);

  // Scale by 2^k
  if (k >= -1021) return k === 1024 ? y * 2 * powerOfTwo(1023) : y * powerOfTwo(k);
  return y * powerOfTwo(k + 1000) * kTwoToMinus1000;
};

const kTwo54 = 1.80143985094819840000e+16;
const kLg1 = 6.666666666666735130e-01;
const kLg2 = 3.999999999940941908e-01;
const kLg3 = 2.857142874366239149e-01;
const kLg4 = 2.222219843214978396e-01;
const kLg5 = 1.818357216161805012e-01;
const kLg6 = 1.531383769920937332e-01;
const kLg7 = 1.479819860511658591e-01;

/** Port of fdlibm e_log.c. */
export const log = (x: number): number => {
  let hx = highWord(x);
  const lx = lowWord(x);
  let k = 0;

  if (hx < 0x00100000) {
    // x < 2^-1022: zero, negative, or subnormal
    if (((hx & 0x7fffffff) | lx) === 0) return -Infinity;
    if (hx < 0) return NaN;
    k -= 54;
    x *= kTwo54;
    hx = highWord(x);
  }
  if (hx >= 0x7ff00000) return x + x;   // Infinity or NaN

  // x = 2^k (1 + f), with 1 + f in [sqrt(2)/2, sqrt(2))
  k += (hx >> 20) - 1023;
  hx &= 0x000fffff;
  const i = (hx + 0x95f64) & 0x100000;
  x = withHighWord(x, hx | (i ^ 0x3ff00000));
  k += i >> 20;
  const f = x - 1;
  const dk = k;

  if ((0x000fffff & (2 + hx)) < 3) {
    // |f| < 2^-20
    if (f === 0) return k === 0 ? 0 : dk * kLn2Hi + dk * kLn2Lo;
    // fdlibm's 0.33333333333333333; the same double
    const rf = f * f * (0.5 - 0.3333333333333333 * f);
    return k === 0 ? f - rf : dk * kLn2Hi - ((rf - dk * kLn2Lo) - f);
  }

  const s = f / (2 + f);
  const z = s * s;
  const w = z * z;
  const t1 = w * (kLg2 + w * (kLg4 + w * kLg6));
  const t2 = z * (kLg1 + w * (kLg3 + w * (kLg5 + w * kLg7)));
  const r = t2 + t1;
  if (((hx - 0x6147a) | (0x6b851 - hx)) > 0) {
    const hfsq = 0.5 * f * f;
    return k === 0 ? f - (hfsq - s * (hfsq + r)) : dk * kLn2Hi - ((hfsq - (s * (hfsq + r) + dk * kLn2Lo)) - f);
  }
  return k === 0 ? f - s * (f - r) : dk * kLn2Hi - ((s * (f - r) - dk * kLn2Lo) - f);
};

/* eslint-enable no-bitwise */
