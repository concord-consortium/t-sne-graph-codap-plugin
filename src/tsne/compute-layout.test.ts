import { computeLayout, ITsneRequest, kProgressInterval, TsneResponse } from "./compute-layout";
import { kTsneSettings } from "./tsne";

const kPhrases = [
  "the cat sat on the mat", "a cat rested on a rug", "the kitten lay on the carpet",
  "the dog ran from the house", "a dog sprinted outside", "the puppy fled the yard",
  "the bird sang in the tree", "a bird chirped on a branch", "the sparrow called at dawn"
];

const run = (request: Partial<ITsneRequest>) => {
  const responses: TsneResponse[] = [];
  computeLayout({ requestId: 7, phrases: kPhrases, seed: 42, progressInterval: kProgressInterval, ...request },
    response => responses.push(response));
  return responses;
};

const finalPositions = (responses: TsneResponse[]) => {
  const last = responses[responses.length - 1];
  return last.type === "done" ? last.positions : undefined;
};

describe("computeLayout", () => {
  it("posts a progress layout every 50 steps, then the final layout", () => {
    const responses = run({});
    const progress = responses.slice(0, -1);
    expect(progress.map(response => response.type === "progress" && response.step)).toEqual(
      Array.from({ length: kTsneSettings.steps / kProgressInterval - 1 }, (_value, i) => (i + 1) * kProgressInterval));
    expect(responses[responses.length - 1].type).toBe("done");
    responses.forEach(response => expect(response.requestId).toBe(7));
    const layouts = responses.map(response => "positions" in response ? response.positions : []);
    layouts.forEach(positions => expect(positions).toHaveLength(kPhrases.length));
  });

  it("gives positions in the unit square, one per phrase in order", () => {
    const positions = finalPositions(run({}));
    expect(positions).toHaveLength(kPhrases.length);
    positions?.forEach(({ x, y }) => {
      [x, y].forEach(value => {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
      });
    });
  });

  it("posts only the final layout when progress is off", () => {
    const responses = run({ progressInterval: 0 });
    expect(responses.map(response => response.type)).toEqual(["done"]);
  });

  it("gives the same layout for the same phrases and seed", () => {
    expect(finalPositions(run({ progressInterval: 0 }))).toEqual(finalPositions(run({})));
  });

  it("gives a different layout for a different seed", () => {
    expect(finalPositions(run({ seed: 43 }))).not.toEqual(finalPositions(run({})));
  });

  it("reports too few phrases below 4", () => {
    expect(run({ phrases: kPhrases.slice(0, 3) })).toEqual([{ type: "too-few", requestId: 7 }]);
  });

  it("lays out exactly 4 phrases", () => {
    expect(finalPositions(run({ phrases: kPhrases.slice(0, 4), progressInterval: 0 }))).toHaveLength(4);
  });

  it("reports too few phrases when no phrase has a word of two or more characters", () => {
    expect(run({ phrases: ["a", "b c", "7", "!?"] })).toEqual([{ type: "too-few", requestId: 7 }]);
  });

  it("reports an error instead of throwing", () => {
    const responses = run({ phrases: undefined as unknown as string[] });
    expect(responses).toHaveLength(1);
    expect(responses[0]).toMatchObject({ type: "error", requestId: 7 });
  });
});
