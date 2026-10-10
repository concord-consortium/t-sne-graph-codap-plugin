// Separate from the worker so it can be tested without one.
import { fitLayout, IPosition, normalizeLayout } from "./layout";
import { IPhrasePlacement, IPlacementLayout, placePhrase } from "./place-phrases";
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

export interface IPlaceRequest {
  type: "place";
  // Both ids are echoed back, so stale replies can be ignored
  placementId: number;
  // The layout to place into; any other gets "no-layout"
  layoutRequestId: number;
  // One per slot; null for an empty slot
  phrases: (string | null)[];
}

export type SlotPlacement = IPhrasePlacement | "empty" | "no-words" | "no-layout";

export interface IPlacedResponse {
  type: "placed";
  placementId: number;
  layoutRequestId: number;
  slots: SlotPlacement[];
}

export type WorkerRequest = ITsneRequest | IPlaceRequest;
export type WorkerResponse = TsneResponse | IPlacedResponse;

/** What a finished layout keeps for placing phrases later. */
export interface IRetainedLayout extends IPlacementLayout {
  requestId: number;
  seed: number;
}

/** Posts progress every `progressInterval` steps, then one final response. Synchronous.
 * Returns the finished layout, or undefined if there is none. */
export const computeLayout = (
  request: ITsneRequest, post: (response: TsneResponse) => void
): IRetainedLayout | undefined => {
  const { requestId, phrases, seed, progressInterval } = request;
  try {
    const { matrix, vocabulary, idf } = fitTfidf(phrases);
    const hasWords = matrix.some(row => row.some(value => value !== 0));
    if (phrases.length < kMinPhrases || !hasWords) {
      post({ type: "too-few", requestId });
      return undefined;
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
    // A copy, so the t-SNE object and its n × n arrays can be freed
    const solution = tsne.solution.map(row => row.slice());
    const { positions, transform } = fitLayout(solution);
    post({ type: "done", requestId, positions });
    return { requestId, seed, model: { vocabulary, idf }, matrix, solution, transform };
  } catch (error) {
    post({ type: "error", requestId, message: error instanceof Error ? error.message : String(error) });
    return undefined;
  }
};

/** Places each slot's phrase into the layout, if the request is for that layout. */
export const answerPlaceRequest = (request: IPlaceRequest, layout: IRetainedLayout | undefined): IPlacedResponse => {
  const { placementId, layoutRequestId, phrases } = request;
  const current = layout?.requestId === layoutRequestId ? layout : undefined;
  const slots = phrases.map((phrase, slot): SlotPlacement => {
    if (phrase === null) return "empty";
    if (!current) return "no-layout";
    return placePhrase(current, phrase, current.seed, slot);
  });
  return { type: "placed", placementId, layoutRequestId, slots };
};

export const isPlaceRequest = (request: WorkerRequest): request is IPlaceRequest =>
  "type" in request && request.type === "place";

/** Handles the worker's messages, keeping the last finished layout for `place` requests. */
export const createRequestHandler = () => {
  let layout: IRetainedLayout | undefined;
  return (request: WorkerRequest, post: (response: WorkerResponse) => void) => {
    if (isPlaceRequest(request)) {
      post(answerPlaceRequest(request, layout));
      return;
    }
    // A new layout replaces the old one, even if it fails (then it is undefined)
    layout = computeLayout(request, post);
  };
};
