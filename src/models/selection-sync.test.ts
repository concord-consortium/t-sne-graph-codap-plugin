import * as codapApi from "@concord-consortium/codap-plugin-api";
import { ClientHandler, IResult } from "@concord-consortium/codap-plugin-api";
import { CaseInfo, IPluginStore, PluginStore } from "./plugin-store";
import { clearCodapSelection, selectInCodap, selectPoint, selectTestPhrase, startSelectionSync } from "./selection-sync";

jest.mock("@concord-consortium/codap-plugin-api", () => ({
  addCasesToSelection: jest.fn(),
  codapInterface: { on: jest.fn() },
  getSelectionList: jest.fn(),
  selectCases: jest.fn()
}));

const api = jest.mocked(codapApi);

// Leaf cases 100 and 101 have parent 10; leaf case 102 has parent 11
const kCases: CaseInfo[] = [
  { caseId: "100", values: { group: "Similar", phrase: "the cat sat" } },
  { caseId: "101", values: { group: "Similar", phrase: "a cat rested" } },
  { caseId: "102", values: { group: "Opposite", phrase: "the dog ran" } }
];

// As getSelectionList sends it: numeric IDs, parents and leaves mixed
let codapSelection: { caseID: number, collectionName: string }[];
const leaf = (caseID: number) => ({ caseID, collectionName: "Cases" });
const parent = (caseID: number) => ({ caseID, collectionName: "Groups" });

const ok = (values: unknown): IResult => ({ success: true, values });
const flush = () => new Promise(resolve => setTimeout(resolve, 0));
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(res => { resolve = res; });
  return { promise, resolve };
};

const selectListener = () => {
  const calls = api.codapInterface.on.mock.calls.filter(([, resource, operation]) =>
    resource === "*" && operation === "selectCases");
  expect(calls).toHaveLength(1);
  return calls[0][3] as unknown as ClientHandler;
};
// As CODAP v3 sends it; `extend` is true for addCasesToSelection and for shift-clicks in the table
const notifySelect = (table: string, extend?: boolean) =>
  selectListener()({ action: "notify", resource: `dataContextChangeNotice[${table}]`,
    values: extend === undefined
      ? { operation: "selectCases" }
      : { operation: "selectCases", result: { success: true, removedCases: [], extend } } });

describe("selection-sync", () => {
  let store: IPluginStore;
  let stop: () => void;
  let consoleError: jest.SpyInstance;

  beforeEach(() => {
    jest.resetAllMocks();
    consoleError = jest.spyOn(console, "error").mockImplementation(() => undefined);
    codapSelection = [];
    api.getSelectionList.mockImplementation(async () => ok(codapSelection));
    api.selectCases.mockResolvedValue(ok({}));
    api.addCasesToSelection.mockResolvedValue(ok({}));
    store = PluginStore.create({ dataContextName: "Phrases", phraseAttributeName: "phrase", tsneSeed: 1 });
  });

  afterEach(() => {
    stop?.();
    consoleError.mockRestore();
  });

  describe("reading CODAP's selection", () => {
    it("registers one selectCases listener for every table", () => {
      stop = startSelectionSync(store);
      expect(api.codapInterface.on).toHaveBeenCalledTimes(1);
      selectListener();
    });

    it("reads the selection after the cases are fetched, as string IDs", async () => {
      codapSelection = [leaf(101)];
      stop = startSelectionSync(store);
      store.setCases(kCases);
      await flush();
      expect(api.getSelectionList).toHaveBeenCalledWith("Phrases");
      expect(Array.from(store.selectedCaseIds)).toEqual(["101"]);
      expect(store.isSelected("101")).toBe(true);
      expect(store.isSelected("100")).toBe(false);
    });

    it("selects every point of a selected parent case, which CODAP lists with its children", async () => {
      stop = startSelectionSync(store);
      store.setCases(kCases);
      await flush();

      codapSelection = [parent(10), leaf(100), leaf(101)];
      notifySelect("Phrases");
      await flush();
      expect(kCases.map(c => store.isSelected(c.caseId))).toEqual([true, true, false]);
    });

    it("reads the selection again on each selectCases notice for the selected table", async () => {
      stop = startSelectionSync(store);
      store.setCases(kCases);
      await flush();

      codapSelection = [leaf(102)];
      notifySelect("Phrases");
      await flush();
      expect(Array.from(store.selectedCaseIds)).toEqual(["102"]);

      codapSelection = [];
      notifySelect("Phrases");
      await flush();
      expect(store.selectedCaseIds.size).toBe(0);
    });

    it("answers each notice with success", () => {
      stop = startSelectionSync(store);
      expect(notifySelect("Phrases")).toEqual({ success: true });
    });

    it("ignores selectCases notices for another table", async () => {
      stop = startSelectionSync(store);
      notifySelect("Other");
      await flush();
      expect(api.getSelectionList).not.toHaveBeenCalled();
    });

    it("empties the selection without asking CODAP when no table is selected", async () => {
      stop = startSelectionSync(store);
      store.setCases(kCases);
      await flush();
      store.setSelectedCaseIds(["100"]);
      api.getSelectionList.mockClear();

      store.setDataContext(undefined);
      await flush();
      expect(store.selectedCaseIds.size).toBe(0);
      expect(api.getSelectionList).not.toHaveBeenCalled();
    });

    it("ignores a selection reply that arrives after a newer one", async () => {
      stop = startSelectionSync(store);
      const slow = deferred<IResult>();
      api.getSelectionList.mockImplementationOnce(() => slow.promise);

      store.setCases(kCases);   // slow read
      codapSelection = [leaf(102)];
      notifySelect("Phrases");
      await flush();
      expect(Array.from(store.selectedCaseIds)).toEqual(["102"]);

      slow.resolve(ok([leaf(100)]));
      await flush();
      expect(Array.from(store.selectedCaseIds)).toEqual(["102"]);
    });

    it("ignores a reply for a table that is no longer selected", async () => {
      stop = startSelectionSync(store);
      const slow = deferred<IResult>();
      api.getSelectionList.mockImplementationOnce(() => slow.promise);
      store.setCases(kCases);   // slow read for Phrases

      store.setDataContext("Other");
      await flush();
      slow.resolve(ok([leaf(100)]));
      await flush();
      expect(store.selectedCaseIds.size).toBe(0);
    });

    it("keeps the selection, and logs an error, when a read fails or throws", async () => {
      codapSelection = [leaf(100)];
      stop = startSelectionSync(store);
      store.setCases(kCases);
      await flush();

      api.getSelectionList.mockResolvedValueOnce({ success: false, values: { error: "busy" } });
      notifySelect("Phrases");
      await flush();
      expect(Array.from(store.selectedCaseIds)).toEqual(["100"]);
      expect(consoleError).toHaveBeenCalledWith("Unable to get the selection of", "Phrases", "busy");

      api.getSelectionList.mockRejectedValueOnce(new Error("timeout"));
      notifySelect("Phrases");
      await flush();
      expect(Array.from(store.selectedCaseIds)).toEqual(["100"]);
      expect(consoleError).toHaveBeenCalledWith("Unable to get the selection of", "Phrases", "timeout");
    });

    it("stops reading after fetches when stopped", async () => {
      stop = startSelectionSync(store);
      stop();
      store.setCases(kCases);
      await flush();
      expect(api.getSelectionList).not.toHaveBeenCalled();
    });
  });

  describe("changing CODAP's selection", () => {
    it("selects leaf cases in place of the current selection, without changing the store", async () => {
      store.setSelectedCaseIds(["102"]);
      await selectInCodap(store, ["100", "101"]);
      expect(api.selectCases).toHaveBeenCalledWith("Phrases", ["100", "101"]);
      expect(api.addCasesToSelection).not.toHaveBeenCalled();
      // The store changes only when CODAP's notice arrives
      expect(Array.from(store.selectedCaseIds)).toEqual(["102"]);
    });

    it("adds leaf cases to the selection when extending", async () => {
      await selectInCodap(store, ["102"], true);
      expect(api.addCasesToSelection).toHaveBeenCalledWith("Phrases", ["102"]);
      expect(api.selectCases).not.toHaveBeenCalled();
    });

    it("clears the selection with an empty list", async () => {
      await clearCodapSelection(store);
      expect(api.selectCases).toHaveBeenCalledWith("Phrases", []);
    });

    it("does nothing when no table is selected", async () => {
      store.setDataContext(undefined);
      await selectInCodap(store, ["100"]);
      await clearCodapSelection(store);
      expect(api.selectCases).not.toHaveBeenCalled();
      expect(api.addCasesToSelection).not.toHaveBeenCalled();
    });

    it("logs an error when CODAP can't be asked", async () => {
      api.selectCases.mockRejectedValueOnce(new Error("timeout"));
      await selectInCodap(store, ["100"]);
      expect(consoleError).toHaveBeenCalledWith("Unable to select cases in", "Phrases", "timeout");
    });
  });

  describe("selecting a point, as CODAP's graph does", () => {
    beforeEach(() => {
      store.setCases(kCases);
    });

    it("selects only an unselected point on a plain click", async () => {
      store.setSelectedCaseIds(["101"]);
      await selectPoint(store, "100", false);
      expect(api.selectCases).toHaveBeenCalledWith("Phrases", ["100"]);
    });

    it("adds an unselected point on a shift-click", async () => {
      store.setSelectedCaseIds(["101"]);
      await selectPoint(store, "100", true);
      expect(api.addCasesToSelection).toHaveBeenCalledWith("Phrases", ["100"]);
    });

    it("leaves the selection alone on a plain click on a selected point", async () => {
      store.setSelectedCaseIds(["100", "102"]);
      await selectPoint(store, "100", false);
      expect(api.selectCases).not.toHaveBeenCalled();
      expect(api.addCasesToSelection).not.toHaveBeenCalled();
    });

    it("removes a selected point on a shift-click, keeping the other selected leaf cases", async () => {
      store.setSelectedCaseIds(["100", "102"]);
      await selectPoint(store, "100", true);
      expect(api.selectCases).toHaveBeenCalledWith("Phrases", ["102"]);
    });

    it("leaves out parent IDs, which would select all their children again", async () => {
      // CODAP lists a selected parent with all its children
      store.setSelectedCaseIds(["10", "100", "101"]);
      await selectPoint(store, "101", true);
      expect(api.selectCases).toHaveBeenCalledWith("Phrases", ["100"]);
    });

    it("keeps selected cases that have no point, such as a blank phrase", async () => {
      store.setCases([...kCases, { caseId: "103", values: { group: "Opposite", phrase: "" } }]);
      store.setSelectedCaseIds(["100", "103"]);
      await selectPoint(store, "100", true);
      expect(api.selectCases).toHaveBeenCalledWith("Phrases", ["103"]);
    });

    it("clears the selection when the last selected point is removed", async () => {
      store.setSelectedCaseIds(["100"]);
      await selectPoint(store, "100", true);
      expect(api.selectCases).toHaveBeenCalledWith("Phrases", []);
    });
  });

  describe("selecting a test phrase", () => {
    it("selects only that slot at once, then clears CODAP's selection", () => {
      store.setSelectedSlots([1, 3]);
      const done = selectTestPhrase(store, 2);
      // Before CODAP answers
      expect(Array.from(store.selectedSlots)).toEqual([2]);
      expect(api.selectCases).toHaveBeenCalledWith("Phrases", []);
      return done;
    });

    it("adds the slot when extending, without asking CODAP", async () => {
      store.setSelectedSlots([1]);
      await selectTestPhrase(store, 3, true);
      expect(Array.from(store.selectedSlots)).toEqual([1, 3]);
      expect(api.selectCases).not.toHaveBeenCalled();
      expect(api.addCasesToSelection).not.toHaveBeenCalled();
    });
  });

  describe("test-phrase (slot) selection with CODAP's notices", () => {
    // Slot 2 is selected by the plugin; CODAP has no selection
    beforeEach(async () => {
      stop = startSelectionSync(store);
      store.setCases(kCases);
      await flush();
      store.setSelectedSlots([2]);
    });

    const slots = () => Array.from(store.selectedSlots);

    it("clears the slots on a table click: a replacing notice with a non-empty selection", async () => {
      codapSelection = [leaf(101)];
      notifySelect("Phrases", false);
      await flush();
      expect(slots()).toEqual([]);
      expect(Array.from(store.selectedCaseIds)).toEqual(["101"]);
    });

    it("treats a notice without extend as replacing", async () => {
      codapSelection = [leaf(101)];
      notifySelect("Phrases");
      await flush();
      expect(slots()).toEqual([]);
    });

    it("keeps the slots on a table shift-click: an extending notice", async () => {
      codapSelection = [leaf(101)];
      notifySelect("Phrases", true);
      await flush();
      expect(slots()).toEqual([2]);
      expect(Array.from(store.selectedCaseIds)).toEqual(["101"]);
    });

    it("keeps the slots on a clear from outside the plugin (the documented limit)", async () => {
      codapSelection = [];
      notifySelect("Phrases", false);
      await flush();
      expect(slots()).toEqual([2]);
    });

    it("keeps the slots on a notice for another table", async () => {
      codapSelection = [leaf(101)];
      notifySelect("Other", false);
      await flush();
      expect(slots()).toEqual([2]);
    });

    it("keeps the slots when the plugin extends with a case, and through its echo", async () => {
      await selectInCodap(store, ["101"], true);
      expect(slots()).toEqual([2]);
      codapSelection = [leaf(101)];
      notifySelect("Phrases", true);
      await flush();
      expect(slots()).toEqual([2]);
    });

    it("clears the slots at once when the plugin selects a case", () => {
      const done = selectInCodap(store, ["101"]);
      expect(slots()).toEqual([]);
      return done;
    });

    it("clears the slots at once on the plugin's own clear (empty space, Escape)", () => {
      const done = clearCodapSelection(store);
      expect(slots()).toEqual([]);
      expect(api.selectCases).toHaveBeenCalledWith("Phrases", []);
      return done;
    });

    it("clears the slots for a replacing select that includes an already-selected case", async () => {
      codapSelection = [leaf(100)];
      notifySelect("Phrases", true);
      await flush();
      expect(slots()).toEqual([2]);
      await selectInCodap(store, ["100", "101"]);
      expect(slots()).toEqual([]);
      // The echo lists only the newly selected case
      codapSelection = [leaf(100), leaf(101)];
      notifySelect("Phrases", false);
      await flush();
      expect(slots()).toEqual([]);
      expect(Array.from(store.selectedCaseIds)).toEqual(["100", "101"]);
    });

    describe("a plain select of a slot ends with only that slot and no cases", () => {
      beforeEach(async () => {
        codapSelection = [leaf(101)];
        notifySelect("Phrases", false);
        await flush();
      });

      it("when the echo arrives before the request settles", async () => {
        const answer = deferred<IResult>();
        api.selectCases.mockImplementationOnce(() => answer.promise);
        const done = selectTestPhrase(store, 3);
        codapSelection = [];
        notifySelect("Phrases", false);
        await flush();
        answer.resolve(ok({}));
        await done;
        expect(slots()).toEqual([3]);
        expect(store.selectedCaseIds.size).toBe(0);
      });

      it("when the echo arrives after the request settles", async () => {
        await selectTestPhrase(store, 3);
        expect(slots()).toEqual([3]);
        codapSelection = [];
        notifySelect("Phrases", false);
        await flush();
        expect(slots()).toEqual([3]);
        expect(store.selectedCaseIds.size).toBe(0);
      });

      it("when no echo arrives", async () => {
        await selectTestPhrase(store, 3);
        await flush();
        expect(slots()).toEqual([3]);
        expect(api.selectCases).toHaveBeenLastCalledWith("Phrases", []);
      });
    });

    it("leaves a slot cleared by a later table click cleared after the slot select's echo", async () => {
      // The plugin selects slot 3, which asks CODAP to clear
      await selectTestPhrase(store, 3);
      // A table click lands before the echo of that clear arrives
      codapSelection = [leaf(102)];
      notifySelect("Phrases", false);
      await flush();
      expect(slots()).toEqual([]);
      // The late echo reads the table click's selection
      notifySelect("Phrases", false);
      await flush();
      expect(slots()).toEqual([]);
      expect(Array.from(store.selectedCaseIds)).toEqual(["102"]);
    });

    it("ignores a replacing notice whose read is overtaken by a newer one", async () => {
      const slow = deferred<IResult>();
      api.getSelectionList.mockImplementationOnce(() => slow.promise);
      notifySelect("Phrases", false);
      // A newer, extending notice reads an empty selection first
      codapSelection = [];
      notifySelect("Phrases", true);
      await flush();
      slow.resolve(ok([leaf(101)]));
      await flush();
      expect(slots()).toEqual([2]);
    });

    it("keeps a slot selected while a replacing notice's read is in progress", async () => {
      // A case click in the plot: its echo's read is slow, and holds the case
      const slow = deferred<IResult>();
      api.getSelectionList.mockImplementationOnce(() => slow.promise);
      notifySelect("Phrases", false);
      // Before the read returns, the student selects a test phrase
      await selectTestPhrase(store, 3);
      slow.resolve(ok([leaf(101)]));
      await flush();
      expect(slots()).toEqual([3]);
      // The echo of the slot select's clear reads the empty selection
      codapSelection = [];
      notifySelect("Phrases", false);
      await flush();
      expect(slots()).toEqual([3]);
      expect(store.selectedCaseIds.size).toBe(0);
    });

    it("still clears the slots when nothing changed them during a slow read", async () => {
      const slow = deferred<IResult>();
      api.getSelectionList.mockImplementationOnce(() => slow.promise);
      notifySelect("Phrases", false);
      slow.resolve(ok([leaf(101)]));
      await flush();
      expect(slots()).toEqual([]);
    });

    it("does not clear the slots when the cases are fetched again", async () => {
      codapSelection = [leaf(101)];
      store.setCases(kCases.slice());
      await flush();
      expect(slots()).toEqual([2]);
    });
  });
});
