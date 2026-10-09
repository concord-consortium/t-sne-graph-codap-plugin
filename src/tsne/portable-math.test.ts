import { exp, log } from "./portable-math";
import { mulberry32 } from "./random";

// The distance between two floats of the same sign in units in the last place: the number of
// floats between them, from their bits. Exact when they are close, which is all these tests need.
const view = new DataView(new ArrayBuffer(8));
const ulps = (a: number, b: number) => {
  if (a === b) return 0;
  if (Math.sign(a) !== Math.sign(b) || !Number.isFinite(a) || !Number.isFinite(b)) return Infinity;
  view.setFloat64(0, Math.abs(a));
  const [aHigh, aLow] = [view.getUint32(0), view.getUint32(4)];
  view.setFloat64(0, Math.abs(b));
  const [bHigh, bLow] = [view.getUint32(0), view.getUint32(4)];
  return Math.abs((aHigh - bHigh) * 2 ** 32 + (aLow - bLow));
};

// Inputs spread over many magnitudes, with both signs where they make sense
const random = mulberry32(2024);
const spread = (count: number, minPower: number, maxPower: number) =>
  Array.from({ length: count }, () => 10 ** (minPower + random() * (maxPower - minPower)));

describe("exp", () => {
  it("handles the special values", () => {
    expect(exp(0)).toBe(1);
    expect(exp(-0)).toBe(1);
    expect(exp(Infinity)).toBe(Infinity);
    expect(exp(-Infinity)).toBe(0);
    expect(exp(NaN)).toBeNaN();
    expect(exp(710)).toBe(Infinity);
    expect(exp(-746)).toBe(0);
  });

  it("is within one unit in the last place of Math.exp across its range", () => {
    const inputs = [
      ...spread(5000, -12, 2.85).map(x => -x), ...spread(5000, -12, 2.85),
      1e-30, 0.5 * Math.LN2, 1.5 * Math.LN2, -708, 709.7, -740, -745
    ];
    const worst = Math.max(...inputs.map(x => ulps(exp(x), Math.exp(x))));
    expect(worst).toBeLessThanOrEqual(1);
  });

  it("gives fdlibm's own result, which can differ from Math.exp in the last place", () => {
    // fdlibm (and Java's StrictMath.exp, which is defined as fdlibm's result) gives this for
    // exp(1), one unit in the last place above Math.E
    expect(exp(1)).toBe(2.7182818284590455);
  });
});

describe("log", () => {
  it("handles the special values", () => {
    expect(log(1)).toBe(0);
    expect(log(0)).toBe(-Infinity);
    expect(log(-0)).toBe(-Infinity);
    expect(log(-1)).toBeNaN();
    expect(log(Infinity)).toBe(Infinity);
    expect(log(NaN)).toBeNaN();
  });

  it("is within one unit in the last place of Math.log across its range", () => {
    const inputs = [
      ...spread(10000, -300, 300), ...spread(2000, -0.01, 0.01),
      Number.MIN_VALUE, 1e-310, Number.MAX_VALUE, 2, 0.5, 1 + 2 ** -30
    ];
    const worst = Math.max(...inputs.map(x => ulps(log(x), Math.log(x))));
    expect(worst).toBeLessThanOrEqual(1);
  });

  it("undoes exp", () => {
    [-20, -1, -0.001, 0.25, 3, 50].forEach(x => expect(log(exp(x))).toBeCloseTo(x, 12));
  });
});
