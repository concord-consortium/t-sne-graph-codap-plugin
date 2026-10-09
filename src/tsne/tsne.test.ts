import { gaussian, mulberry32 } from "./random";
import { clampPerplexity, kTsneSettings, Tsne } from "./tsne";

// Three clusters of 10 points each in 8 dimensions: centers 10 apart on different axes, with a
// little noise
const kClusterSize = 10;
const makeClusters = () => {
  const noise = gaussian(mulberry32(1234));
  const points: number[][] = [];
  [0, 1, 2].forEach(cluster => {
    for (let i = 0; i < kClusterSize; i++) {
      points.push(Array.from({ length: 8 }, (_value, axis) => (axis === cluster ? 10 : 0) + 0.5 * noise()));
    }
  });
  return points;
};

const run = (X: number[][], seed: number, steps: number) => {
  const tsne = new Tsne({
    perplexity: clampPerplexity(kTsneSettings.perplexity, X.length),
    epsilon: kTsneSettings.epsilon,
    random: mulberry32(seed)
  });
  tsne.initData(X);
  for (let i = 0; i < steps; i++) tsne.step();
  return tsne.solution.map(point => [...point]);
};

const distance = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1]);

const allFinite = (layout: number[][]) => layout.every(point => point.every(value => Number.isFinite(value)));

describe("clampPerplexity", () => {
  it("keeps the perplexity when there are enough points", () => {
    expect(clampPerplexity(40, 300)).toBe(40);
    expect(clampPerplexity(40, 121)).toBe(40);
  });

  it("lowers it to (n - 1) / 3, rounded down, for fewer points", () => {
    expect(clampPerplexity(40, 120)).toBe(39);
    expect(clampPerplexity(40, 30)).toBe(9);
    expect(clampPerplexity(40, 4)).toBe(1);
  });

  it("gives 0 below 4 points", () => {
    expect(clampPerplexity(40, 3)).toBe(0);
  });
});

describe("Tsne", () => {
  const clusters = makeClusters();

  it("gives the same layout for the same data and seed", () => {
    expect(run(clusters, 42, 200)).toEqual(run(clusters, 42, 200));
  });

  it("gives a different layout for a different seed", () => {
    expect(run(clusters, 42, 200)).not.toEqual(run(clusters, 43, 200));
  });

  it("keeps well-separated clusters apart", () => {
    const layout = run(clusters, 42, kTsneSettings.steps);
    const centers = [0, 1, 2].map(cluster => {
      const points = layout.slice(cluster * kClusterSize, (cluster + 1) * kClusterSize);
      return [0, 1].map(d => points.reduce((sum, point) => sum + point[d], 0) / points.length);
    });
    // Every point is nearer its own cluster's center than any other center
    layout.forEach((point, i) => {
      const own = Math.floor(i / kClusterSize);
      const distances = centers.map(center => distance(point, center));
      expect(distances.indexOf(Math.min(...distances))).toBe(own);
    });
  });

  it("keeps the layout centered on 0", () => {
    const layout = run(clusters, 42, 50);
    [0, 1].forEach(d => {
      const mean = layout.reduce((sum, point) => sum + point[d], 0) / layout.length;
      expect(mean).toBeCloseTo(0, 10);
    });
  });

  it("starts with every point near 0 and counts its steps", () => {
    const tsne = new Tsne({ perplexity: 9, epsilon: 100, random: mulberry32(1) });
    tsne.initData(clusters);
    expect(tsne.iteration).toBe(0);
    tsne.solution.forEach(point => point.forEach(value => expect(Math.abs(value)).toBeLessThan(1e-3)));
    tsne.step();
    tsne.step();
    expect(tsne.iteration).toBe(2);
  });

  it("lays out the smallest allowed data set, 4 points", () => {
    const X = clusters.slice(0, 4);
    const layout = run(X, 42, kTsneSettings.steps);
    expect(layout).toHaveLength(4);
    expect(allFinite(layout)).toBe(true);
  });

  it("lays out points that are all the same", () => {
    expect(allFinite(run(Array.from({ length: 5 }, () => [0, 0, 0]), 42, 100))).toBe(true);
  });

  it("rejects empty data", () => {
    const tsne = new Tsne({ perplexity: 1, epsilon: 100, random: mulberry32(1) });
    expect(() => tsne.initData([])).toThrow("at least one point");
    expect(() => tsne.initData([[], []])).toThrow("at least one value");
  });
});
