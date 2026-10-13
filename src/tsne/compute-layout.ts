// Separate from the worker so it can be tested without one.
import { IPosition, normalizeLayout } from "./layout";
import { mulberry32 } from "./random";
import { fitTfidf } from "./tfidf";
import { clampPerplexity, kTsneSettings, Tsne } from "./tsne";

// Below this, the clamped perplexity drops under 1
export const kMinPhrases = 4;
export const kProgressInterval = 50;

export interface ITsneRequest {
  // Echoed back, so stale responses can be ignored
  requestId: number;
  phrases: string[];
  seed: number;
  // 0 for none (reduced motion)
  progressInterval: number;
}

export type TsneResponse =
  | { type: "progress", requestId: number, step: number, positions: IPosition[] }
  | { type: "done", requestId: number, positions: IPosition[] }
  // Also when no phrase has a word of 2+ characters
  | { type: "too-few", requestId: number }
  | { type: "error", requestId: number, message: string };

/** Posts progress every `progressInterval` steps, then one final response. Synchronous. */
export const computeLayout = (request: ITsneRequest, post: (response: TsneResponse) => void) => {
  const { requestId, phrases, seed, progressInterval } = request;
  try {
    const { matrix } = fitTfidf(phrases);
    const hasWords = matrix.some(row => row.some(value => value !== 0));
    if (phrases.length < kMinPhrases || !hasWords) {
      post({ type: "too-few", requestId });
      return;
    }

    const tsne = new Tsne({
      perplexity: clampPerplexity(kTsneSettings.perplexity, phrases.length),
      epsilon: kTsneSettings.epsilon,
      random: mulberry32(seed)
    });
    tsne.initData(matrix);
    for (let step = 1; step <= kTsneSettings.steps; step++) {
      tsne.step();
      if (progressInterval > 0 && step % progressInterval === 0 && step < kTsneSettings.steps) {
        post({ type: "progress", requestId, step, positions: normalizeLayout(tsne.solution) });
      }
    }
    post({ type: "done", requestId, positions: normalizeLayout(tsne.solution) });
  } catch (error) {
    post({ type: "error", requestId, message: error instanceof Error ? error.message : String(error) });
  }
};
