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

  it("never calls Math.exp or Math.log, which differ in the last bit between engines", () => {
    // Their last-bit differences between engines grow into different layouts
    const mathExp = jest.spyOn(Math, "exp");
    const mathLog = jest.spyOn(Math, "log");
    run({ progressInterval: 0 });
    expect(mathExp).not.toHaveBeenCalled();
    expect(mathLog).not.toHaveBeenCalled();
    mathExp.mockRestore();
    mathLog.mockRestore();
  });

  it("gives exactly this layout for these phrases and seed, to the last bit", () => {
    // The same in Chromium, Firefox and WebKit. If this changes, saved documents reopen differently.
    const kExpected = [
      [0.6594446699256002, 0.5206976031892093], [0.8355309844620429, 0.40660784320865145],
      [0.7029595963086366, 0.660742507011833], [0.43070083602575204, 0.20615942346039517],
      [0.4096139141741564, 0], [0.4042908327195728, 0.497904260620371], [0.3650569349467857, 0.7891626991309955],
      [0.3447929418646023, 1], [0.16446901553795717, 0.4696658296835533]
    ];
    expect(finalPositions(run({ progressInterval: 0 }))?.map(({ x, y }) => [x, y])).toEqual(kExpected);
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
