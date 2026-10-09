import { applySnapshot, getSnapshot } from "mobx-state-tree";
import { ITsneRequest, kProgressInterval, TsneResponse } from "../tsne/compute-layout";
import { createTsneWorker } from "../tsne/create-tsne-worker";
import { startGraphController } from "./graph-controller";
import { CaseInfo, IPluginStore, PluginStore } from "./plugin-store";

// The real module uses import.meta, which Jest can't compile; the factory keeps it from loading
jest.mock("../tsne/create-tsne-worker", () => ({ createTsneWorker: jest.fn() }));

// A stand-in for the t-SNE worker: records requests, and lets a test send replies
class FakeWorker {
  onmessage: ((event: MessageEvent<TsneResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  requests: ITsneRequest[] = [];
  terminated = false;
  postMessage(request: ITsneRequest) {
    this.requests.push(request);
  }
  terminate() {
    this.terminated = true;
  }
  get lastRequest() {
    return this.requests[this.requests.length - 1];
  }
  reply(response: TsneResponse) {
    this.onmessage?.({ data: response } as MessageEvent<TsneResponse>);
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
// The layout's fixed order, by phrase: "a dog ran", "a fish swam", "the bird sang", "the cat sat"
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

  // A store with a table, a Phrase and Label Column, a seed, and cases
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

  it("reports an error when the worker can't be created, and tries again on the next change", () => {
    // For example, a security policy that blocks workers
    mockedCreateWorker.mockImplementationOnce(() => { throw new Error("Workers are blocked"); });
    stop = startGraphController(store);
    expect(store.computeStatus).toBe("error");
    expect(store.points).toEqual([]);
    expect(consoleError).toHaveBeenCalledWith("Unable to start the t-SNE worker:", "Workers are blocked");

    store.setCases(kCases.slice(1));
    expect(workers).toHaveLength(1);
    expect(store.computeStatus).toBe("computing");
  });

  it("drops the points and goes idle when the Phrase Column is cleared", () => {
    stop = startGraphController(store);
    const worker = lastWorker();
    store.setPhraseAttribute(undefined);
    expect(store.points).toEqual([]);
    expect(store.computeStatus).toBe("idle");
    // It was still working, so it is stopped
    expect(worker.terminated).toBe(true);
  });

  it("drops the points and goes idle when a different table is selected", () => {
    stop = startGraphController(store);
    lastWorker().reply({ type: "done", requestId: lastWorker().lastRequest.requestId, positions: kPositions });
    store.setDataContext("Other");
    expect(store.points).toEqual([]);
    expect(store.computeStatus).toBe("idle");
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
