import * as codapApi from "@concord-consortium/codap-plugin-api";
import { ClientHandler, IResult } from "@concord-consortium/codap-plugin-api";
import { CaseInfo, IPluginStore, PluginStore } from "./plugin-store";
import { clearCodapSelection, selectInCodap, startSelectionSync } from "./selection-sync";

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
const notifySelect = (table: string) =>
  selectListener()({ action: "notify", resource: `dataContextChangeNotice[${table}]`,
    values: { operation: "selectCases" } });

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

    it("keeps the selection when a read fails, and logs an error when it throws", async () => {
      codapSelection = [leaf(100)];
      stop = startSelectionSync(store);
      store.setCases(kCases);
      await flush();

      api.getSelectionList.mockResolvedValueOnce({ success: false, values: { error: "busy" } });
      notifySelect("Phrases");
      await flush();
      expect(Array.from(store.selectedCaseIds)).toEqual(["100"]);

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
});
