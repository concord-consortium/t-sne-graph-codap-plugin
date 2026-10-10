import { applyTransform, fitLayout } from "./layout";
import { IPlacementLayout, kJitterStandardDeviation, nearestRow, placePhrase, slotSeed } from "./place-phrases";
import { fitTfidf, ITfidfModel } from "./tfidf";

const phrases = ["the cat sat", "a dog ran", "red apples fall", "the cat ran"];

// Far-apart raw positions, so each row's placement is easy to tell apart
const solution = [[-100, 0], [0, 100], [100, 0], [0, -100]];

const makeLayout = (tablePhrases: string[], raw: number[][]): IPlacementLayout => {
  const { matrix, vocabulary, idf } = fitTfidf(tablePhrases);
  return { model: { vocabulary, idf }, matrix, solution: raw, transform: fitLayout(raw).transform };
};

const layout = makeLayout(phrases, solution);

// Unit square back to raw t-SNE units
const toRaw = ({ x, y }: { x: number, y: number }) => {
  const { minX, minY, range, offsetX, offsetY } = layout.transform;
  return [minX + (x - offsetX) * range, minY + (y - offsetY) * range];
};

describe("nearestRow", () => {
  it("chooses the row with the largest dot product", () => {
    const matrix = [[1, 0, 0], [0, 0.6, 0.8], [0, 1, 0]];
    // Dot products 0, 0.8, 0.96
    expect(nearestRow(matrix, [0, 0.96, 0.28])).toBe(2);
    // Dot products 0, 1, 0.6
    expect(nearestRow(matrix, [0, 0.6, 0.8])).toBe(1);
  });

  it("chooses the lowest index when rows tie", () => {
    const matrix = [[0, 1], [1, 0], [1, 0]];
    expect(nearestRow(matrix, [1, 0])).toBe(1);
  });

  it("never chooses a row that is all zeros", () => {
    // Cosine 0.3 with row 1: by Euclidean distance, the zero rows (distance 1) would be nearer
    const matrix = [[0, 0, 0], [0.3, Math.sqrt(0.91), 0], [0, 0, 0]];
    expect(nearestRow(matrix, [1, 0, 0])).toBe(1);
  });

  it("returns -1 when every row is all zeros", () => {
    expect(nearestRow([[0, 0], [0, 0]], [1, 0])).toBe(-1);
  });
});

describe("placePhrase", () => {
  it("puts a phrase identical to a row within the jitter of that row", () => {
    phrases.forEach((phrase, i) => {
      const placement = placePhrase(layout, phrase, 42, 0);
      if (placement === "no-words") throw new Error("expected a placement");
      expect(placement.neighborIndex).toBe(i);
      const [x, y] = toRaw(placement);
      // Well inside 5 standard deviations per axis
      expect(Math.abs(x - solution[i][0])).toBeLessThan(5 * kJitterStandardDeviation);
      expect(Math.abs(y - solution[i][1])).toBeLessThan(5 * kJitterStandardDeviation);
    });
  });

  it("chooses the most similar row for a phrase not in the table", () => {
    const placement = placePhrase(layout, "my red apples", 42, 0);
    expect(placement).toMatchObject({ neighborIndex: 2 });
  });

  it("never places beside a row with no words, even for a weak match", () => {
    // Rows 0 and 2 have no word of 2+ characters, so their vectors are all zeros
    const table = makeLayout(["a b", "green tea and lemon cake", "x", "lemon pie"], solution);
    expect(table.matrix[0].every(value => value === 0)).toBe(true);
    expect(table.matrix[2].every(value => value === 0)).toBe(true);
    const placement = placePhrase(table, "lemon", 42, 0);
    expect(placement).toMatchObject({ neighborIndex: 3 });
    // Weak match: one word of five
    expect(placePhrase(table, "green", 42, 0)).toMatchObject({ neighborIndex: 1 });
  });

  it("chooses the lowest index when rows tie", () => {
    const table = makeLayout(["blue sky", "blue sky", "green sea", "dark night"], solution);
    expect(placePhrase(table, "blue sky", 42, 0)).toMatchObject({ neighborIndex: 0 });
  });

  it("returns no-words for a phrase with no word in the vocabulary", () => {
    expect(placePhrase(layout, "zebra quilt", 42, 0)).toBe("no-words");
    expect(placePhrase(layout, "a b c", 42, 0)).toBe("no-words");
    expect(placePhrase(layout, "", 42, 0)).toBe("no-words");
  });

  it("gives the same placement for the same seed and slot", () => {
    expect(placePhrase(layout, "the cat", 42, 3)).toEqual(placePhrase(layout, "the cat", 42, 3));
  });

  it("gives different jitter to different slots and different seeds", () => {
    const placements = [0, 1, 2, 3, 4].map(slot => placePhrase(layout, "the cat sat", 42, slot));
    const keys = new Set(placements.map(placement => JSON.stringify(placement)));
    expect(keys.size).toBe(5);
    expect(placePhrase(layout, "the cat sat", 43, 0)).not.toEqual(placements[0]);
  });

  it("jitters by about 0.2 raw units on each axis", () => {
    const offsets: number[] = [];
    for (let seed = 0; seed < 2000; seed++) {
      const placement = placePhrase(layout, "the cat sat", seed, 0);
      if (placement === "no-words") throw new Error("expected a placement");
      const [x, y] = toRaw(placement);
      offsets.push(x - solution[0][0], y - solution[0][1]);
    }
    const mean = offsets.reduce((sum, value) => sum + value, 0) / offsets.length;
    const sd = Math.sqrt(offsets.reduce((sum, value) => sum + (value - mean) ** 2, 0) / offsets.length);
    expect(Math.abs(mean)).toBeLessThan(0.02);
    expect(sd).toBeCloseTo(kJitterStandardDeviation, 1);
  });

  it("returns the jitter's unit direction", () => {
    const placement = placePhrase(layout, "the cat sat", 42, 0);
    if (placement === "no-words") throw new Error("expected a placement");
    const neighbor = applyTransform(layout.transform, solution[0]);
    const offset = { x: placement.x - neighbor.x, y: placement.y - neighbor.y };
    const length = Math.hypot(offset.x, offset.y);
    expect(Math.hypot(placement.direction.dx, placement.direction.dy)).toBeCloseTo(1, 12);
    expect(placement.direction.dx).toBeCloseTo(offset.x / length, 9);
    expect(placement.direction.dy).toBeCloseTo(offset.y / length, 9);
  });

  it("maps through the layout's transform to the unit square", () => {
    // A single-row table whose layout is one point: the transform sends everything to the center
    const model: ITfidfModel = { vocabulary: new Map([["cat", 0]]), idf: [1] };
    const single: IPlacementLayout =
      { model, matrix: [[1]], solution: [[5, 5]], transform: fitLayout([[5, 5]]).transform };
    expect(placePhrase(single, "cat", 42, 0)).toMatchObject({ x: 0.5, y: 0.5, neighborIndex: 0 });
  });
});

describe("slotSeed", () => {
  it("is a 32-bit unsigned integer that differs by slot", () => {
    const seeds = [0, 1, 2, 3, 4].map(slot => slotSeed(42, slot));
    expect(new Set(seeds).size).toBe(5);
    seeds.forEach(seed => {
      expect(Number.isInteger(seed)).toBe(true);
      expect(seed).toBeGreaterThanOrEqual(0);
      expect(seed).toBeLessThan(2 ** 32);
    });
  });
});
