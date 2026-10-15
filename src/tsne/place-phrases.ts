// Port of the original page's addUserPhrase
import { applyTransform, IDirection, ILayoutTransform, IPosition, unitDirection } from "./layout";
import { gaussian, mulberry32 } from "./random";
import { ITfidfModel, vectorize } from "./tfidf";

// In raw t-SNE units, as in the original
export const kJitterStandardDeviation = 0.2;

/** Rows are in the layout's phrase order. */
export interface IPlacementLayout {
  model: ITfidfModel;
  matrix: readonly (readonly number[])[];
  solution: readonly (readonly number[])[];
  transform: ILayoutTransform;
}

export interface IPhrasePlacement extends IPosition {
  neighborIndex: number;
  // The jitter's unit direction; +x when it is zero
  direction: IDirection;
}

const dot = (a: readonly number[], b: readonly number[]) => a.reduce((sum, value, i) => sum + value * b[i], 0);

const isZero = (row: readonly number[]) => row.every(value => value === 0);

/** Highest cosine among non-zero rows; ties go to the lowest index. Zero rows are skipped: a unit
 * query is distance 1 from them, nearer than any real row with cosine < 0.5. */
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
export const slotSeed = (seed: number, slot: number) => (seed ^ Math.imul(slot + 1, 0x9e3779b9)) >>> 0;
/* eslint-enable no-bitwise */

/** Deterministic for a phrase, seed and slot. Can fall slightly outside the unit square; clamped
 * when drawn. */
export const placePhrase = (
  layout: IPlacementLayout, phrase: string, seed: number, slot: number
): IPhrasePlacement | "no-words" => {
  const query = vectorize(layout.model, phrase);
  if (isZero(query)) return "no-words";
  // A word in the query is in some row too, so a row is found
  const neighborIndex = nearestRow(layout.matrix, query);

  const randn = gaussian(mulberry32(slotSeed(seed, slot)));
  const jitterX = kJitterStandardDeviation * randn();
  const jitterY = kJitterStandardDeviation * randn();
  const [x, y] = layout.solution[neighborIndex];
  return {
    ...applyTransform(layout.transform, [x + jitterX, y + jitterY]),
    neighborIndex,
    // Uniform scale, so the raw direction is the unit-square direction
    direction: unitDirection(jitterX, jitterY)
  };
};
