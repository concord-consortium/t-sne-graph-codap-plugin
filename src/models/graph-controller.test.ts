import { applySnapshot, getSnapshot } from "mobx-state-tree";
import {
  IPlacedResponse, IPlaceRequest, isPlaceRequest, ITsneRequest, kProgressInterval, SlotPlacement, WorkerRequest,
  WorkerResponse
} from "../tsne/compute-layout";
import { createTsneWorker } from "../tsne/create-tsne-worker";
import { startGraphController } from "./graph-controller";
import { CaseInfo, IPluginStore, PluginStore } from "./plugin-store";

// Each test supplies a fake worker
jest.mock("../tsne/create-tsne-worker", () => ({ createTsneWorker: jest.fn() }));

// Records layout and place requests separately; tests send its replies
class FakeWorker {
  onmessage: ((event: MessageEvent<WorkerResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  requests: ITsneRequest[] = [];
  placeRequests: IPlaceRequest[] = [];
  terminated = false;
  postMessage(request: WorkerRequest) {
    if (isPlaceRequest(request)) this.placeRequests.push(request);
    else this.requests.push(request);
  }
  terminate() {
    this.terminated = true;
  }
  get lastRequest() {
    return this.requests[this.requests.length - 1];
  }
  get lastPlaceRequest() {
    return this.placeRequests[this.placeRequests.length - 1];
  }
  reply(response: WorkerResponse) {
    this.onmessage?.({ data: response } as MessageEvent<WorkerResponse>);
  }
  replyPlaced(request: IPlaceRequest, slots: SlotPlacement[]) {
    const { placementId, layoutRequestId } = request;
    const response: IPlacedResponse = { type: "placed", placementId, layoutRequestId, slots };
    this.reply(response);
  }
  fail(message: string) {
    this.onerror?.({ message } as ErrorEvent);
  }
}

const mockedCreateWorker = jest.mocked(createTsneWorker);
let workers: FakeWorker[];
const lastWorker = () => workers[workers.length - 1];

const kCases: CaseInfo[] = [
  { caseId: "1", values: { phrase: "the cat sat", label: "Similar" } },
  { caseId: "2", values: { phrase: "a dog ran", label: "Opposite" } },
  { caseId: "3", values: { phrase: "the bird sang", label: "Similar" } },
  { caseId: "4", values: { phrase: "a fish swam", label: "Other" } }
];
// Sorted by phrase: "a dog ran", "a fish swam", "the bird sang", "the cat sat"
const kLayoutCaseIds = ["2", "4", "3", "1"];
const kLayoutPhrases = ["a dog ran", "a fish swam", "the bird sang", "the cat sat"];
const kPositions = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }];
const kPoints = kPositions.map((position, i) => ({ caseId: kLayoutCaseIds[i], ...position }));

const setReducedMotion = (reduce: boolean | undefined) => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: reduce === undefined ? undefined : jest.fn(() => ({ matches: reduce }))
  });
};

describe("startGraphController", () => {
  let store: IPluginStore;
  let stop: () => void;
  let consoleError: jest.SpyInstance;

  const readyStore = () => {
    const ready = PluginStore.create({ dataContextName: "Phrases", tsneSeed: 42 });
    ready.setPhraseAttribute("phrase");
    ready.setLabelAttribute("label");
    ready.setCases(kCases);
    return ready;
  };

  beforeEach(() => {
    workers = [];
    mockedCreateWorker.mockReset();
    mockedCreateWorker.mockImplementation(() => {
      const worker = new FakeWorker();
      workers.push(worker);
      return worker as unknown as Worker;
    });
    consoleError = jest.spyOn(console, "error").mockImplementation(() => undefined);
    setReducedMotion(false);
    store = readyStore();
  });

  afterEach(() => {
    stop?.();
    consoleError.mockRestore();
    setReducedMotion(undefined);
  });

  it("does nothing while there are no rows", () => {
    store = PluginStore.create({ dataContextName: "Phrases", tsneSeed: 42 });
    store.setCases(kCases);   // no Phrase Column yet
    stop = startGraphController(store);
    expect(mockedCreateWorker).not.toHaveBeenCalled();
    expect(store.computeStatus).toBe("idle");
  });

  it("asks the worker to lay out the phrases, sorted, with the seed", () => {
    stop = startGraphController(store);
    expect(workers).toHaveLength(1);
    expect(lastWorker().requests).toEqual([{
      requestId: expect.any(Number),
      phrases: kLayoutPhrases,
      seed: 42,
      progressInterval: kProgressInterval
    }]);
    expect(store.computeStatus).toBe("computing");
    expect(store.points).toEqual([]);
  });

  it("shows each progress layout, then the final one, on the rows' case IDs", () => {
    stop = startGraphController(store);
    const { requestId } = lastWorker().lastRequest;
    lastWorker().reply({ type: "progress", requestId, step: 50, positions: kPositions.slice().reverse() });
    expect(store.points.map(point => point.caseId)).toEqual(kLayoutCaseIds);
    expect(store.points[0]).toEqual({ caseId: "2", x: 1, y: 1 });
    expect(store.computeStatus).toBe("computing");

    lastWorker().reply({ type: "done", requestId, positions: kPositions });
    expect(store.points).toEqual(kPoints);
    expect(store.computeStatus).toBe("done");
  });

  it("asks for the final layout only when the user prefers reduced motion", () => {
    setReducedMotion(true);
    stop = startGraphController(store);
    expect(lastWorker().lastRequest.progressInterval).toBe(0);
  });

  it("works without matchMedia", () => {
    setReducedMotion(undefined);
    stop = startGraphController(store);
    expect(lastWorker().lastRequest.progressInterval).toBe(kProgressInterval);
  });

  it("clears the points at once when a phrase changes, and lays out again", () => {
    stop = startGraphController(store);
    const first = lastWorker().lastRequest;
    lastWorker().reply({ type: "done", requestId: first.requestId, positions: kPositions });

    store.setCases(kCases.map((c, i) => i === 0 ? { ...c, values: { ...c.values, phrase: "the cat slept" } } : c));
    expect(store.points).toEqual([]);
    expect(store.computeStatus).toBe("computing");
    // The idle worker is reused
    expect(workers).toHaveLength(1);
    expect(lastWorker().lastRequest.phrases).toContain("the cat slept");
    expect(lastWorker().lastRequest.phrases).not.toContain("the cat sat");
    expect(lastWorker().lastRequest.requestId).not.toBe(first.requestId);
  });

  it("lays out again when rows are added or removed", () => {
    stop = startGraphController(store);
    store.setCases(kCases.slice(1));
    expect(lastWorker().lastRequest.phrases).toHaveLength(3);
    store.setCases(kCases);
    expect(lastWorker().lastRequest.phrases).toEqual(kLayoutPhrases);
  });

  it("keeps the layout when the table is only sorted or regrouped", () => {
    stop = startGraphController(store);
    const { requestId } = lastWorker().lastRequest;
    lastWorker().reply({ type: "done", requestId, positions: kPositions });

    store.setCases(kCases.slice().reverse());
    store.setCases([kCases[2], kCases[0], kCases[3], kCases[1]]);
    expect(lastWorker().requests).toHaveLength(1);
    expect(store.points).toEqual(kPoints);
    expect(store.computeStatus).toBe("done");
  });

  it("lays out the same phrases in the same order whatever the table's order", () => {
    stop = startGraphController(store);
    const first = lastWorker().lastRequest;
    stop();
    store = readyStore();
    store.setCases(kCases.slice().reverse());
    stop = startGraphController(store);
    expect(lastWorker().lastRequest.phrases).toEqual(first.phrases);
  });

  it("orders repeated phrases by case ID", () => {
    store.setCases([
      { caseId: "9", values: { phrase: "same words" } }, { caseId: "10", values: { phrase: "same words" } },
      { caseId: "3", values: { phrase: "other words" } }, { caseId: "4", values: { phrase: "more words" } }
    ]);
    stop = startGraphController(store);
    const { requestId } = lastWorker().lastRequest;
    expect(lastWorker().lastRequest.phrases).toEqual(["more words", "other words", "same words", "same words"]);
    lastWorker().reply({ type: "done", requestId, positions: kPositions });
    // Case IDs compare as text: "10" before "9"
    expect(store.points.map(point => point.caseId)).toEqual(["4", "3", "10", "9"]);
  });

  it("only recolors when the labels change: no new layout and the points stay", () => {
    stop = startGraphController(store);
    const { requestId } = lastWorker().lastRequest;
    lastWorker().reply({ type: "done", requestId, positions: kPositions });

    store.setLabelAttribute(undefined);
    store.setCases(kCases.map(c => ({ ...c, values: { ...c.values, label: "Changed" } })));
    expect(lastWorker().requests).toHaveLength(1);
    expect(store.points).toEqual(kPoints);
    expect(store.computeStatus).toBe("done");
  });

  it("lays out again when the seed changes, and not when it stays the same", () => {
    stop = startGraphController(store);
    store.ensureTsneSeed();   // keeps 42
    expect(lastWorker().requests).toHaveLength(1);
    lastWorker().reply({ type: "done", requestId: lastWorker().lastRequest.requestId, positions: kPositions });

    // Restoring a snapshot is how the seed can change
    applySnapshot(store, { ...getSnapshot(store), tsneSeed: 7 });
    expect(lastWorker().requests.map(request => request.seed)).toEqual([42, 7]);
  });

  it("creates a missing seed first, then lays out once with it", () => {
    store = PluginStore.create({ dataContextName: "Phrases", phraseAttributeName: "phrase" });
    store.setCases(kCases);
    expect(store.tsneSeed).toBeUndefined();
    stop = startGraphController(store);
    expect(store.tsneSeed).toEqual(expect.any(Number));
    expect(workers).toHaveLength(1);
    expect(lastWorker().requests).toHaveLength(1);
    expect(lastWorker().lastRequest.seed).toBe(store.tsneSeed);
  });

  it("stops a busy worker for a newer request, and ignores the old request's replies", () => {
    stop = startGraphController(store);
    const oldWorker = lastWorker();
    const oldRequest = oldWorker.lastRequest;

    store.setCases(kCases.slice(1));
    expect(oldWorker.terminated).toBe(true);
    expect(workers).toHaveLength(2);
    expect(lastWorker().lastRequest.phrases).toHaveLength(3);

    oldWorker.reply({ type: "done", requestId: oldRequest.requestId, positions: kPositions });
    expect(store.points).toEqual([]);
    expect(store.computeStatus).toBe("computing");
  });

  it("ignores a reply to an older request from the same worker", () => {
    stop = startGraphController(store);
    const { requestId } = lastWorker().lastRequest;
    lastWorker().reply({ type: "done", requestId, positions: kPositions });
    store.setCases(kCases.slice(1));

    lastWorker().reply({ type: "progress", requestId, step: 50, positions: kPositions });
    expect(store.points).toEqual([]);
  });

  it("reports too few phrases", () => {
    stop = startGraphController(store);
    lastWorker().reply({ type: "too-few", requestId: lastWorker().lastRequest.requestId });
    expect(store.computeStatus).toBe("too-few");
    expect(store.points).toEqual([]);
  });

  it("clears a progress layout when the layout reports an error", () => {
    stop = startGraphController(store);
    const { requestId } = lastWorker().lastRequest;
    lastWorker().reply({ type: "progress", requestId, step: 50, positions: kPositions });
    expect(store.points).toHaveLength(4);
    lastWorker().reply({ type: "error", requestId, message: "bad data" });
    expect(store.points).toEqual([]);
    expect(store.computeStatus).toBe("error");
  });

  it("reports an error from the layout and logs it", () => {
    stop = startGraphController(store);
    lastWorker().reply({ type: "error", requestId: lastWorker().lastRequest.requestId, message: "bad data" });
    expect(store.computeStatus).toBe("error");
    expect(consoleError).toHaveBeenCalledWith("Unable to lay out the phrases:", "bad data");
  });

  it("reports a failed worker, and starts a new one for the next request", () => {
    stop = startGraphController(store);
    const failed = lastWorker();
    failed.fail("script not found");
    expect(store.computeStatus).toBe("error");
    expect(failed.terminated).toBe(true);
    expect(consoleError).toHaveBeenCalledWith("The t-SNE worker failed:", "script not found");

    store.setCases(kCases.slice(1));
    expect(workers).toHaveLength(2);
    expect(store.computeStatus).toBe("computing");
  });

  it("clears the points and test-phrase points when the worker fails after its layout", () => {
    store.setTestPhrase(0, "the cat");
    stop = startGraphController(store);
    lastWorker().reply({ type: "done", requestId: lastWorker().lastRequest.requestId, positions: kPositions });
    const placeRequest = lastWorker().lastPlaceRequest;
    lastWorker().reply({ type: "placed", placementId: placeRequest.placementId,
      layoutRequestId: placeRequest.layoutRequestId,
      slots: [{ x: 0.5, y: 0.5, neighborIndex: 3, direction: { dx: 1, dy: 0 } }, "empty", "empty", "empty", "empty"] });
    expect(store.testPhrasePoints).toHaveLength(1);

    lastWorker().fail("crashed");
    expect(store.computeStatus).toBe("error");
    expect(store.points).toEqual([]);
    expect(store.testPhrasePoints).toEqual([]);
    expect(store.placementStatus).toEqual({});
  });

  it("clears a progress layout when the worker fails before finishing", () => {
    stop = startGraphController(store);
    lastWorker().reply({ type: "progress", requestId: lastWorker().lastRequest.requestId, step: 50,
      positions: kPositions });
    expect(store.points).toHaveLength(4);
    lastWorker().fail("crashed");
    expect(store.points).toEqual([]);
    expect(store.computeStatus).toBe("error");
  });

  it("reports an error when the worker can't be created, and tries again on the next change", () => {
    mockedCreateWorker.mockImplementationOnce(() => { throw new Error("Workers are blocked"); });
    stop = startGraphController(store);
    expect(store.computeStatus).toBe("error");
    expect(store.points).toEqual([]);
    expect(consoleError).toHaveBeenCalledWith("Unable to start the t-SNE worker:", "Workers are blocked");

    store.setCases(kCases.slice(1));
    expect(workers).toHaveLength(1);
    expect(store.computeStatus).toBe("computing");
  });

  it("only logs a failure from a worker that was already replaced", () => {
    stop = startGraphController(store);
    const oldWorker = lastWorker();
    store.setCases(kCases.slice(1));   // the busy old worker is replaced
    const newWorker = lastWorker();

    oldWorker.fail("late failure");
    expect(consoleError).toHaveBeenCalledWith("The t-SNE worker failed:", "late failure");
    expect(store.computeStatus).toBe("computing");
    expect(newWorker.terminated).toBe(false);
  });

  it("drops the points and goes idle when the Phrase Column is cleared", () => {
    stop = startGraphController(store);
    const worker = lastWorker();
    store.setPhraseAttribute(undefined);
    expect(store.points).toEqual([]);
    expect(store.computeStatus).toBe("idle");
    // Still busy, so stopped
    expect(worker.terminated).toBe(true);
  });

  it("drops the points and goes idle when a different table is selected", () => {
    stop = startGraphController(store);
    lastWorker().reply({ type: "done", requestId: lastWorker().lastRequest.requestId, positions: kPositions });
    store.setDataContext("Other");
    expect(store.points).toEqual([]);
    expect(store.computeStatus).toBe("idle");
  });

  describe("the view", () => {
    const kZoomed = { zoomLevel: 2, centerX: 0.3, centerY: 0.6 };
    const zoom = () => {
      store.zoomIn();
      store.zoomIn();
      store.panTo(kZoomed.centerX, kZoomed.centerY);
    };
    const finishLayout = () =>
      lastWorker().reply({ type: "done", requestId: lastWorker().lastRequest.requestId, positions: kPositions });

    it("resets when a phrase edit in the table replaces the shown layout", () => {
      stop = startGraphController(store);
      finishLayout();
      zoom();
      store.setCases(kCases.map((c, i) => i === 0 ? { ...c, values: { ...c.values, phrase: "the cat slept" } } : c));
      expect(lastWorker().requests).toHaveLength(2);
      expect(store.isFitView).toBe(true);
    });

    it("resets when a progress layout is showing", () => {
      stop = startGraphController(store);
      lastWorker().reply({ type: "progress", requestId: lastWorker().lastRequest.requestId, step: 50,
        positions: kPositions });
      zoom();
      store.setCases(kCases.slice(1));
      expect(store.isFitView).toBe(true);
    });

    it("resets when the seed changes with the layout shown", () => {
      stop = startGraphController(store);
      finishLayout();
      zoom();
      applySnapshot(store, { ...getSnapshot(store), tsneSeed: 7 });
      expect(store.isFitView).toBe(true);
    });

    it("keeps the saved view through the first layout after a restore", () => {
      store = PluginStore.create({ dataContextName: "Phrases", phraseAttributeName: "phrase",
        labelAttributeName: "label", tsneSeed: 42, view: kZoomed });
      store.setCases(kCases);
      stop = startGraphController(store);
      expect(lastWorker().requests).toHaveLength(1);
      finishLayout();
      expect(store.view).toEqual(kZoomed);
    });

    it("keeps the view on a Label Column change", () => {
      stop = startGraphController(store);
      finishLayout();
      zoom();
      store.setLabelAttribute(undefined);
      expect(lastWorker().requests).toHaveLength(1);
      expect(store.view).toEqual(kZoomed);
    });

    it("is fit after the Phrase Column is cleared, the view zoomed, and another column chosen", () => {
      stop = startGraphController(store);
      finishLayout();
      store.setPhraseAttribute(undefined);
      expect(store.points).toEqual([]);
      zoom();
      // No points shown, so the store action resets the view, not the controller
      store.setPhraseAttribute("label");
      expect(lastWorker().requests).toHaveLength(2);
      expect(store.isFitView).toBe(true);
    });
  });

  it("stops the worker and stops reacting when stopped", () => {
    stop = startGraphController(store);
    const worker = lastWorker();
    stop();
    expect(worker.terminated).toBe(true);
    store.setCases(kCases.slice(1));
    expect(workers).toHaveLength(1);
  });
});

describe("startGraphController test-phrase placement", () => {
  let store: IPluginStore;
  let stop: () => void;

  const kDirection = { dx: 1, dy: 0 };
  // Neighbor index 3 is "the cat sat", case 1, in layout order
  const placement = (neighborIndex: number, x = 0.25): SlotPlacement =>
    ({ x, y: 0.5, neighborIndex, direction: kDirection });
  const kAllEmpty: SlotPlacement[] = ["empty", "empty", "empty", "empty", "empty"];

  const finishLayout = () => {
    lastWorker().reply({ type: "done", requestId: lastWorker().lastRequest.requestId, positions: kPositions });
  };

  beforeEach(() => {
    workers = [];
    mockedCreateWorker.mockReset();
    mockedCreateWorker.mockImplementation(() => {
      const worker = new FakeWorker();
      workers.push(worker);
      return worker as unknown as Worker;
    });
    setReducedMotion(false);
    store = PluginStore.create({ dataContextName: "Phrases", tsneSeed: 42 });
    store.setPhraseAttribute("phrase");
    store.setCases(kCases);
  });

  afterEach(() => {
    stop?.();
    setReducedMotion(undefined);
  });

  it("places the phrases right after the layout is done, with null for empty slots", () => {
    store.setTestPhrase(0, "the cat");
    store.setTestPhrase(3, "a fish");
    stop = startGraphController(store);
    expect(lastWorker().placeRequests).toEqual([]);
    const { requestId } = lastWorker().lastRequest;
    finishLayout();
    expect(lastWorker().placeRequests).toEqual([{
      type: "place", placementId: expect.any(Number), layoutRequestId: requestId,
      phrases: ["the cat", null, null, "a fish", null]
    }]);
  });

  it("does not place while there is no finished layout", () => {
    stop = startGraphController(store);
    store.setTestPhrase(0, "the cat");
    lastWorker().reply({ type: "progress", requestId: lastWorker().lastRequest.requestId, step: 50,
      positions: kPositions });
    expect(lastWorker().placeRequests).toEqual([]);
  });

  it("stores the placed points with their neighbors' case IDs, and each slot's status", () => {
    store.setTestPhrase(0, "the cat");
    store.setTestPhrase(2, "zebra");
    stop = startGraphController(store);
    finishLayout();
    lastWorker().replyPlaced(lastWorker().lastPlaceRequest,
      [placement(3), "empty", "no-words", "empty", "empty"]);
    expect(store.testPhrasePoints).toEqual([
      { slot: 0, x: 0.25, y: 0.5, neighborCaseId: "1", direction: kDirection }
    ]);
    expect(store.placementStatus).toEqual({ 0: "placed", 1: "empty", 2: "no-words", 3: "empty", 4: "empty" });
  });

  it("gives no status to a slot answered no-layout", () => {
    store.setTestPhrase(0, "the cat");
    stop = startGraphController(store);
    finishLayout();
    lastWorker().replyPlaced(lastWorker().lastPlaceRequest, ["no-layout", "empty", "empty", "empty", "empty"]);
    expect(store.testPhrasePoints).toEqual([]);
    expect(store.placementStatus).toEqual({ 1: "empty", 2: "empty", 3: "empty", 4: "empty" });
  });

  it("places again, with a larger placementId, when the phrases change", () => {
    stop = startGraphController(store);
    finishLayout();
    const first = lastWorker().lastPlaceRequest;
    store.setTestPhrase(1, "a dog");
    const second = lastWorker().lastPlaceRequest;
    expect(lastWorker().placeRequests).toHaveLength(2);
    expect(second.placementId).toBeGreaterThan(first.placementId);
    expect(second.layoutRequestId).toBe(first.layoutRequestId);
    expect(second.phrases).toEqual([null, "a dog", null, null, null]);
  });

  it("sends nothing for an unchanged commit", () => {
    store.setTestPhrase(0, "the cat");
    stop = startGraphController(store);
    finishLayout();
    store.setTestPhrase(0, " the  cat ");
    expect(lastWorker().placeRequests).toHaveLength(1);
  });

  it("removes a changed phrase's old point before the new placement arrives", () => {
    store.setTestPhrase(0, "the cat");
    stop = startGraphController(store);
    finishLayout();
    lastWorker().replyPlaced(lastWorker().lastPlaceRequest, [placement(3), "empty", "empty", "empty", "empty"]);
    store.setTestPhrase(0, "a dog");
    expect(store.testPhrasePoints).toEqual([]);
    lastWorker().replyPlaced(lastWorker().lastPlaceRequest, [placement(0, 0.75), "empty", "empty", "empty", "empty"]);
    expect(store.testPhrasePoints).toEqual([
      { slot: 0, x: 0.75, y: 0.5, neighborCaseId: "2", direction: kDirection }
    ]);
  });

  it("clears the test-phrase points when the layout is recomputed, and places into the new one", () => {
    store.setTestPhrase(0, "the cat");
    stop = startGraphController(store);
    finishLayout();
    const oldPlace = lastWorker().lastPlaceRequest;
    lastWorker().replyPlaced(oldPlace, [placement(3), "empty", "empty", "empty", "empty"]);
    store.setSelectedSlots([0]);

    store.setCases(kCases.map((c, i) => i === 1 ? { ...c, values: { ...c.values, phrase: "a dog slept" } } : c));
    expect(store.testPhrasePoints).toEqual([]);
    expect(store.placementStatus).toEqual({});
    // No layout yet: an edit sends nothing
    store.setTestPhrase(1, "a bird");
    expect(lastWorker().placeRequests).toHaveLength(1);
    lastWorker().replyPlaced(oldPlace, [placement(3), "empty", "empty", "empty", "empty"]);
    expect(store.testPhrasePoints).toEqual([]);

    const newLayout = lastWorker().lastRequest.requestId;
    finishLayout();
    const newPlace = lastWorker().lastPlaceRequest;
    expect(newPlace.layoutRequestId).toBe(newLayout);
    expect(newPlace.phrases).toEqual(["the cat", "a bird", null, null, null]);
    lastWorker().replyPlaced(newPlace, [placement(3), placement(0), "empty", "empty", "empty"]);
    expect(store.testPhrasePoints.map(point => point.slot)).toEqual([0, 1]);
    expect(store.isSlotSelected(0)).toBe(true);
  });

  it("applies only the latest of several rapid edits, whatever order the replies arrive in", () => {
    stop = startGraphController(store);
    finishLayout();
    store.setTestPhrase(0, "the");
    store.setTestPhrase(0, "the cat");
    store.setTestPhrase(0, "the cat sat");
    const [, first, second, third] = lastWorker().placeRequests;
    expect(lastWorker().placeRequests).toHaveLength(4);

    lastWorker().replyPlaced(third, [placement(3, 0.3), "empty", "empty", "empty", "empty"]);
    expect(store.testPhrasePoints).toEqual([
      { slot: 0, x: 0.3, y: 0.5, neighborCaseId: "1", direction: kDirection }
    ]);
    lastWorker().replyPlaced(first, [placement(0, 0.1), "empty", "empty", "empty", "empty"]);
    lastWorker().replyPlaced(second, [placement(1, 0.2), "empty", "empty", "empty", "empty"]);
    expect(store.testPhrasePoints).toEqual([
      { slot: 0, x: 0.3, y: 0.5, neighborCaseId: "1", direction: kDirection }
    ]);
  });

  it("ignores a reply whose placementId matches but whose layout does not", () => {
    store.setTestPhrase(0, "the cat");
    stop = startGraphController(store);
    finishLayout();
    const request = lastWorker().lastPlaceRequest;
    lastWorker().replyPlaced({ ...request, layoutRequestId: request.layoutRequestId - 1 },
      [placement(3), "empty", "empty", "empty", "empty"]);
    expect(store.testPhrasePoints).toEqual([]);
    expect(store.placementStatus).toEqual({});
  });

  it("does not place after the worker fails, until a new layout is done", () => {
    const consoleError = jest.spyOn(console, "error").mockImplementation(() => undefined);
    store.setTestPhrase(0, "the cat");
    stop = startGraphController(store);
    finishLayout();
    const failed = lastWorker();
    failed.fail("crashed");
    store.setTestPhrase(1, "a dog");
    expect(failed.placeRequests).toHaveLength(1);
    expect(workers).toHaveLength(1);

    store.setCases(kCases.slice(1));
    finishLayout();
    expect(lastWorker().lastPlaceRequest.phrases).toEqual(["the cat", "a dog", null, null, null]);
    consoleError.mockRestore();
  });

  it("unselects a selected slot that a new layout leaves with no point", () => {
    store.setTestPhrase(0, "the cat");
    store.setTestPhrase(1, "a dog");
    stop = startGraphController(store);
    finishLayout();
    lastWorker().replyPlaced(lastWorker().lastPlaceRequest, [placement(3), placement(0), "empty", "empty", "empty"]);
    store.setSelectedSlots([0, 1]);

    // A new layout in which slot 0's phrase has no words
    store.setCases(kCases.slice(1));
    expect(store.isSlotSelected(0)).toBe(true);
    finishLayout();
    lastWorker().replyPlaced(lastWorker().lastPlaceRequest, ["no-words", placement(0), "empty", "empty", "empty"]);
    expect(Array.from(store.selectedSlots)).toEqual([1]);

    store.setCases(kCases);
    finishLayout();
    lastWorker().replyPlaced(lastWorker().lastPlaceRequest, [placement(3), placement(0), "empty", "empty", "empty"]);
    expect(store.isSlotSelected(0)).toBe(false);
    expect(store.isSlotSelected(1)).toBe(true);
  });

  describe("a layout that ends with no placement drops the slot selection", () => {
    let consoleError: jest.SpyInstance;

    // Slot 0 placed and selected
    beforeEach(() => {
      consoleError = jest.spyOn(console, "error").mockImplementation(() => undefined);
      store.setTestPhrase(0, "the cat");
      stop = startGraphController(store);
      finishLayout();
      lastWorker().replyPlaced(lastWorker().lastPlaceRequest, [placement(3), "empty", "empty", "empty", "empty"]);
      store.setSelectedSlots([0]);
    });

    afterEach(() => {
      consoleError.mockRestore();
    });

    // New phrases, so a layout always runs
    const placeAgain = () => {
      store.setCases([...kCases, { caseId: "5", values: { phrase: "a frog hopped" } }]);
      finishLayout();
      lastWorker().replyPlaced(lastWorker().lastPlaceRequest, [placement(3), "empty", "empty", "empty", "empty"]);
      expect(store.testPhrasePoints).toHaveLength(1);
      expect(store.isSlotSelected(0)).toBe(false);
    };

    it("when the table has no rows", () => {
      store.setCases([]);
      expect(store.computeStatus).toBe("idle");
      expect(store.selectedSlots.size).toBe(0);
      placeAgain();
    });

    it("when there are too few phrases", () => {
      store.setCases(kCases.slice(1));
      lastWorker().reply({ type: "too-few", requestId: lastWorker().lastRequest.requestId });
      expect(store.selectedSlots.size).toBe(0);
      placeAgain();
    });

    it("when the layout reports an error", () => {
      store.setCases(kCases.slice(1));
      lastWorker().reply({ type: "error", requestId: lastWorker().lastRequest.requestId, message: "bad data" });
      expect(store.selectedSlots.size).toBe(0);
      placeAgain();
    });

    it("when the worker fails", () => {
      lastWorker().fail("crashed");
      expect(store.selectedSlots.size).toBe(0);
      placeAgain();
    });

    it("when a new worker can't be created", () => {
      lastWorker().fail("crashed");
      store.setSelectedSlots([0]);
      mockedCreateWorker.mockImplementationOnce(() => { throw new Error("Workers are blocked"); });
      store.setCases(kCases.slice(1));
      expect(store.computeStatus).toBe("error");
      expect(store.selectedSlots.size).toBe(0);
      placeAgain();
    });
  });

  it("leaves the slot selection alone when every selected slot is placed", () => {
    store.setTestPhrase(0, "the cat");
    stop = startGraphController(store);
    finishLayout();
    store.setSelectedSlots([0]);
    const selected = store.selectedSlots;
    lastWorker().replyPlaced(lastWorker().lastPlaceRequest, [placement(3), "empty", "empty", "empty", "empty"]);
    // The same Set, as refreshSelection in selection-sync.ts needs
    expect(store.selectedSlots).toBe(selected);
  });

  it("stops placing when stopped", () => {
    stop = startGraphController(store);
    finishLayout();
    const worker = lastWorker();
    stop();
    store.setTestPhrase(0, "the cat");
    expect(worker.placeRequests).toHaveLength(1);
  });

  it("marks every slot empty when there are no phrases", () => {
    stop = startGraphController(store);
    finishLayout();
    expect(lastWorker().lastPlaceRequest.phrases).toEqual([null, null, null, null, null]);
    lastWorker().replyPlaced(lastWorker().lastPlaceRequest, kAllEmpty);
    expect(store.placementStatus).toEqual({ 0: "empty", 1: "empty", 2: "empty", 3: "empty", 4: "empty" });
  });
});
