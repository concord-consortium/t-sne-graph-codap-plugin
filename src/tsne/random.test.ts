import { gaussian, mulberry32 } from "./random";

const take = (random: () => number, count: number) => Array.from({ length: count }, random);

describe("mulberry32", () => {
  it("gives the same sequence for the same seed", () => {
    expect(take(mulberry32(42), 20)).toEqual(take(mulberry32(42), 20));
  });

  it("gives different sequences for different seeds", () => {
    expect(take(mulberry32(42), 20)).not.toEqual(take(mulberry32(43), 20));
  });

  it("gives numbers in [0, 1) spread across the range", () => {
    const values = take(mulberry32(1), 10000);
    values.forEach(value => {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    });
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    expect(mean).toBeCloseTo(0.5, 1);
  });

  it("uses only the low 32 bits of the seed", () => {
    expect(take(mulberry32(2 ** 32 + 5), 5)).toEqual(take(mulberry32(5), 5));
  });
});

describe("gaussian", () => {
  it("gives the same sequence for the same seed", () => {
    expect(take(gaussian(mulberry32(42)), 20)).toEqual(take(gaussian(mulberry32(42)), 20));
  });

  it("has mean 0 and standard deviation 1", () => {
    const values = take(gaussian(mulberry32(3)), 20000);
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
    expect(mean).toBeCloseTo(0, 1);
    expect(Math.sqrt(variance)).toBeCloseTo(1, 1);
  });

  it("keeps its saved value apart from other generators", () => {
    // Taking values from a second generator between calls must not change the first one's sequence
    const alone = take(gaussian(mulberry32(9)), 4);
    const first = gaussian(mulberry32(9));
    const other = gaussian(mulberry32(10));
    const interleaved = [first(), other(), first(), other(), first(), first()]
      .filter((_value, i) => ![1, 3].includes(i));
    expect(interleaved).toEqual(alone);
  });
});
