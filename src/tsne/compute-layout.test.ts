import {
  answerPlaceRequest, computeLayout, createRequestHandler, IPlaceRequest, ITsneRequest, kProgressInterval,
  TsneResponse, WorkerRequest, WorkerResponse
} from "./compute-layout";
import { applyTransform } from "./layout";
import { placePhrase } from "./place-phrases";
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

  it("never calls Math.exp or Math.log, which can differ in the last bit between engines", () => {
    const mathExp = jest.spyOn(Math, "exp");
    const mathLog = jest.spyOn(Math, "log");
    run({ progressInterval: 0 });
    expect(mathExp).not.toHaveBeenCalled();
    expect(mathLog).not.toHaveBeenCalled();
    mathExp.mockRestore();
    mathLog.mockRestore();
  });

  it("gives exactly this layout for these phrases and seed, to the last bit", () => {
    // Checked once against Chromium, Firefox and WebKit. If this changes, saved documents reopen differently.
    const kExpected = [
      [0.6594446699256002, 0.5206976031892093], [0.8355309844620429, 0.40660784320865145],
      [0.7029595963086366, 0.660742507011833], [0.43070083602575204, 0.20615942346039517],
      [0.4096139141741564, 0], [0.4042908327195728, 0.497904260620371], [0.3650569349467857, 0.7891626991309955],
      [0.3447929418646023, 1], [0.16446901553795717, 0.4696658296835533]
    ];
    expect(finalPositions(run({ progressInterval: 0 }))?.map(({ x, y }) => [x, y])).toEqual(kExpected);
  });

  it("gives the same final layout with or without progress messages", () => {
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

describe("computeLayout's retained layout", () => {
  const layoutRequest: ITsneRequest = { requestId: 7, phrases: kPhrases, seed: 42, progressInterval: 0 };

  it("returns the model, rows, raw solution and transform of the finished layout", () => {
    const responses: TsneResponse[] = [];
    const layout = computeLayout(layoutRequest, response => responses.push(response));
    if (!layout) throw new Error("expected a layout");
    expect(layout.requestId).toBe(7);
    expect(layout.seed).toBe(42);
    expect(layout.matrix).toHaveLength(kPhrases.length);
    expect(layout.model.vocabulary.get("cat")).toEqual(expect.any(Number));
    expect(layout.solution).toHaveLength(kPhrases.length);
    const positions = finalPositions(responses);
    layout.solution.forEach((point, i) => expect(applyTransform(layout.transform, point)).toEqual(positions?.[i]));
  });

  it("returns nothing when there are too few phrases or an error", () => {
    expect(computeLayout({ ...layoutRequest, phrases: kPhrases.slice(0, 3) }, () => undefined)).toBeUndefined();
    expect(computeLayout({ ...layoutRequest, phrases: undefined as unknown as string[] }, () => undefined))
      .toBeUndefined();
  });
});

describe("answerPlaceRequest", () => {
  const layout = computeLayout({ requestId: 7, phrases: kPhrases, seed: 42, progressInterval: 0 }, () => undefined);
  const placeRequest = (request: Partial<IPlaceRequest>): IPlaceRequest =>
    ({ type: "place", placementId: 1, layoutRequestId: 7, phrases: [null, null, null, null, null], ...request });

  it("echoes both ids", () => {
    expect(answerPlaceRequest(placeRequest({ placementId: 12 }), layout))
      .toMatchObject({ type: "placed", placementId: 12, layoutRequestId: 7 });
  });

  it("answers each slot: a placement, empty or no-words", () => {
    const { slots } = answerPlaceRequest(
      placeRequest({ phrases: ["the cat sat on the mat", null, "zebra quilt", null, "a bird in a tree"] }), layout);
    expect(slots).toHaveLength(5);
    expect(slots[0]).toMatchObject({ neighborIndex: 0 });
    expect(slots[1]).toBe("empty");
    expect(slots[2]).toBe("no-words");
    expect(slots[3]).toBe("empty");
    expect(slots[4]).toMatchObject({ neighborIndex: expect.any(Number) });
  });

  it("places with the layout's seed and each phrase's slot", () => {
    if (!layout) throw new Error("expected a layout");
    const { slots } = answerPlaceRequest(placeRequest({ phrases: [null, null, "the dog ran", null, "the dog ran"] }),
      layout);
    expect(slots[2]).toEqual(placePhrase(layout, "the dog ran", 42, 2));
    expect(slots[4]).toEqual(placePhrase(layout, "the dog ran", 42, 4));
    expect(slots[2]).not.toEqual(slots[4]);
  });

  it("answers no-layout for a different layout's id, but still empty for empty slots", () => {
    const { slots, layoutRequestId } = answerPlaceRequest(
      placeRequest({ layoutRequestId: 6, phrases: ["the cat sat", null, null, null, null] }), layout);
    expect(layoutRequestId).toBe(6);
    expect(slots).toEqual(["no-layout", "empty", "empty", "empty", "empty"]);
  });

  it("answers error for a slot whose placement throws, and still places the others", () => {
    if (!layout) throw new Error("expected a layout");
    const consoleError = jest.spyOn(console, "error").mockImplementation(() => undefined);
    // A model with no vocabulary makes vectorize throw
    const broken = { ...layout, model: undefined as unknown as typeof layout.model };
    const { slots } = answerPlaceRequest(placeRequest({ phrases: ["the cat sat", null, null, null, null] }), broken);
    expect(slots).toEqual(["error", "empty", "empty", "empty", "empty"]);
    expect(consoleError).toHaveBeenCalledWith("Unable to place a test phrase:", expect.any(String));
    consoleError.mockRestore();
  });

  it("answers no-layout when there is no layout", () => {
    expect(answerPlaceRequest(placeRequest({ phrases: ["the cat sat", null, null, null, null] }), undefined).slots)
      .toEqual(["no-layout", "empty", "empty", "empty", "empty"]);
  });
});

describe("createRequestHandler", () => {
  const send = (handle: ReturnType<typeof createRequestHandler>, request: WorkerRequest) => {
    const responses: WorkerResponse[] = [];
    handle(request, response => responses.push(response));
    return responses;
  };
  const layoutRequest = (requestId: number, phrases = kPhrases): ITsneRequest =>
    ({ requestId, phrases, seed: 42, progressInterval: 0 });
  const place = (layoutRequestId: number, placementId = 1): IPlaceRequest =>
    ({ type: "place", placementId, layoutRequestId, phrases: ["the cat sat", null, null, null, null] });

  it("answers a layout request as computeLayout does", () => {
    const handle = createRequestHandler();
    expect(send(handle, layoutRequest(7))).toEqual(run({ progressInterval: 0 }));
  });

  it("places into the last finished layout", () => {
    const handle = createRequestHandler();
    send(handle, layoutRequest(7));
    const [response] = send(handle, place(7, 3));
    expect(response).toMatchObject({ type: "placed", placementId: 3, layoutRequestId: 7 });
    expect(response.type === "placed" && response.slots[0]).toMatchObject({ neighborIndex: 0 });
  });

  it("answers no-layout before any layout", () => {
    const handle = createRequestHandler();
    expect(send(handle, place(7))).toEqual([
      { type: "placed", placementId: 1, layoutRequestId: 7, slots: ["no-layout", "empty", "empty", "empty", "empty"] }
    ]);
  });

  it("answers no-layout for the old layout once a new one is done", () => {
    const handle = createRequestHandler();
    send(handle, layoutRequest(7));
    send(handle, layoutRequest(8, kPhrases.slice(0, 6)));
    const [stale] = send(handle, place(7));
    expect(stale.type === "placed" && stale.slots[0]).toBe("no-layout");
    const [current] = send(handle, place(8));
    expect(current.type === "placed" && current.slots[0]).toMatchObject({ neighborIndex: 0 });
  });

  it("drops the old layout when a new one has too few phrases", () => {
    const handle = createRequestHandler();
    send(handle, layoutRequest(7));
    expect(send(handle, layoutRequest(8, kPhrases.slice(0, 3)))).toEqual([{ type: "too-few", requestId: 8 }]);
    const [response] = send(handle, place(7));
    expect(response.type === "placed" && response.slots[0]).toBe("no-layout");
  });
});
