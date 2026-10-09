// The t-SNE pipeline the worker runs: TF-IDF, then t-SNE, then positions in the unit square.
// A plain function, so it can be tested without a worker (CODAP-1571 plan §4.2 steps 3–4).
import { IPosition, normalizeLayout } from "./layout";
import { mulberry32 } from "./random";
import { fitTfidf } from "./tfidf";
import { clampPerplexity, kTsneSettings, Tsne } from "./tsne";

// Fewer phrases than this give a meaningless layout (and a perplexity below 1)
export const kMinPhrases = 4;
// Steps between progress messages, so the points visibly settle
export const kProgressInterval = 50;

export interface ITsneRequest {
  // Echoed in every response, so the sender can ignore responses to an older request
  requestId: number;
  phrases: string[];
  seed: number;
  // Steps between progress messages; 0 for none (reduced motion)
  progressInterval: number;
}

export type TsneResponse =
  // An intermediate layout, one position per phrase
  | { type: "progress", requestId: number, step: number, positions: IPosition[] }
  // The final layout
  | { type: "done", requestId: number, positions: IPosition[] }
  // Too few phrases, or no phrase has a word of two or more characters
  | { type: "too-few", requestId: number }
  | { type: "error", requestId: number, message: string };

/**
 * Lays out the phrases and reports through `post`: progress messages every `progressInterval`
 * steps, then one final message ("done", "too-few" or "error"). Runs to the end before returning.
 */
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
