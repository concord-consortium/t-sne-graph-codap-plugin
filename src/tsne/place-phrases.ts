// Port of the original's addUserPhrase: a new phrase goes beside its nearest table phrase.
import { applyTransform, IDirection, ILayoutTransform, IPosition, unitDirection } from "./layout";
import { gaussian, mulberry32 } from "./random";
import { ITfidfModel, vectorize } from "./tfidf";

// In raw t-SNE units, as in the original
export const kJitterStandardDeviation = 0.2;

/** What a finished layout keeps for placing new phrases. Rows are in the layout's phrase order. */
export interface IPlacementLayout {
  model: ITfidfModel;
  matrix: readonly (readonly number[])[];
  solution: readonly (readonly number[])[];
  transform: ILayoutTransform;
}

export interface IPhrasePlacement extends IPosition {
  // Index of the nearest row in the layout's phrase order
  neighborIndex: number;
  // Unit direction of the jitter in the unit square; +x when the jitter is zero
  direction: IDirection;
}

const dot = (a: readonly number[], b: readonly number[]) => a.reduce((sum, value, i) => sum + value * b[i], 0);

const isZero = (row: readonly number[]) => row.every(value => value === 0);

/** Highest cosine similarity among non-zero rows; ties go to the lowest index. Rows and the
 * query are unit length, so this is also the nearest by Euclidean distance. Zero rows are
 * excluded: a unit query is exactly 1 from them, which would beat a real row with cosine < 0.5. */
export const nearestRow = (matrix: readonly (readonly number[])[], query: readonly number[]) => {
  let best = -1;
  let bestScore = -Infinity;
  matrix.forEach((row, i) => {
    if (isZero(row)) return;
    const score = dot(row, query);
    if (score > bestScore) {
      best = i;
      bestScore = score;
    }
  });
  return best;
};

/* eslint-disable no-bitwise */
/** A different generator seed for each slot. */
export const slotSeed = (seed: number, slot: number) => (seed ^ Math.imul(slot + 1, 0x9e3779b9)) >>> 0;
/* eslint-enable no-bitwise */

/** The same phrase, seed and slot always give the same placement. Positions can fall a little
 * outside the unit square; they are clamped when drawn. */
export const placePhrase = (
  layout: IPlacementLayout, phrase: string, seed: number, slot: number
): IPhrasePlacement | "no-words" => {
  const query = vectorize(layout.model, phrase);
  if (isZero(query)) return "no-words";
  const neighborIndex = nearestRow(layout.matrix, query);
  if (neighborIndex < 0) return "no-words";

  const randn = gaussian(mulberry32(slotSeed(seed, slot)));
  const jitterX = kJitterStandardDeviation * randn();
  const jitterY = kJitterStandardDeviation * randn();
  const [x, y] = layout.solution[neighborIndex];
  return {
    ...applyTransform(layout.transform, [x + jitterX, y + jitterY]),
    neighborIndex,
    // One scale for both axes, so the raw direction is also the unit-square direction
    direction: unitDirection(jitterX, jitterY)
  };
};
