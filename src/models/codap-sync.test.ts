import * as codapApi from "@concord-consortium/codap-plugin-api";
import { ClientHandler, IResult } from "@concord-consortium/codap-plugin-api";
import { kMaxInitAttempts, startCodapSync } from "./codap-sync";
import { IPluginStore, PluginStore } from "./plugin-store";

jest.mock("@concord-consortium/codap-plugin-api", () => ({
  addDataContextChangeListener: jest.fn(),
  addDataContextsListListener: jest.fn(),
  codapInterface: { init: jest.fn(), on: jest.fn() },
  getAttributeList: jest.fn(),
  getCollectionList: jest.fn(),
  getListOfDataContexts: jest.fn()
}));

const api = jest.mocked(codapApi);

// A fake CODAP document: each table is a list of collections, parent first
type FakeDocument = Record<string, { title?: string, collections: Record<string, string[]> }>;
let codapDocument: FakeDocument;

const kPhrases: FakeDocument = {
  Phrases: { title: "My Phrases", collections: { Groups: ["group"], Cases: ["phrase", "label"] } },
  Other: { collections: { Items: ["text"] } }
};

const ok = (values: unknown): IResult => ({ success: true, values });

const fakeCodap = () => {
  api.getListOfDataContexts.mockImplementation(async () =>
    ok(Object.entries(codapDocument).map(([name, { title }]) => ({ name, title: title ?? "", id: 1 }))));
  api.getCollectionList.mockImplementation(async (dc) =>
    ok(Object.keys(codapDocument[dc].collections).map(name => ({ name, title: name, id: 2 }))));
  api.getAttributeList.mockImplementation(async (dc, coll) =>
    ok(codapDocument[dc].collections[coll].map(name => ({ name, title: name.toUpperCase(), id: 3 }))));
};

// Wait for pending promises to settle
const flush = () => new Promise(resolve => setTimeout(resolve, 0));

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(res => { resolve = res; });
  return { promise, resolve };
};

// The handler the plugin registered for CODAP's "get interactiveState" request
const stateHandler = () => {
  const call = api.codapInterface.on.mock.calls.find(([action, resource]) =>
    action === "get" && resource === "interactiveState");
  return call?.[2] as unknown as () => IResult;
};

const tableListener = (name: string) => {
  const calls = api.addDataContextChangeListener.mock.calls.filter(([dc]) => dc === name);
  expect(calls).toHaveLength(1);
  return calls[0][1];
};
const notify = (listener: ClientHandler, operation: string, resource = "dataContextChangeNotice") =>
  listener({ action: "notify", resource, values: { operation } });

const savedSelections = { dataContextName: "Phrases", phraseAttributeName: "phrase", labelAttributeName: "group" };

describe("startCodapSync", () => {
  let store: IPluginStore;
  let consoleError: jest.SpyInstance;

  beforeEach(() => {
    jest.resetAllMocks();
    consoleError = jest.spyOn(console, "error").mockImplementation(() => undefined);
    codapDocument = JSON.parse(JSON.stringify(kPhrases));
    fakeCodap();
    api.codapInterface.init.mockResolvedValue(undefined);
    store = PluginStore.create();
  });

  afterEach(() => {
    consoleError.mockRestore();
  });

  it("connects with the plugin name, tile size and its own interactiveState handler", async () => {
    await startCodapSync(store);
    expect(api.codapInterface.init).toHaveBeenCalledWith({
      name: "t-SNE Plot",
      version: "0.0.1",
      // 300px of content below CODAP's 34px title bar
      dimensions: { width: 680, height: 334 },
      customInteractiveStateHandler: true
    });
  });

  it("answers CODAP's state request with no value until restore finishes", async () => {
    const init = deferred<unknown>();
    api.codapInterface.init.mockReturnValue(init.promise);
    const started = startCodapSync(store);

    expect(stateHandler()()).toEqual({ success: true });

    init.resolve(savedSelections);
    await started;
    expect(stateHandler()()).toEqual({ success: true, values: { version: 1, ...savedSelections } });
  });

  it("restores the saved state before fetching from CODAP", async () => {
    api.codapInterface.init.mockResolvedValue(savedSelections);
    let tableWhenFetching: string | undefined;
    api.getListOfDataContexts.mockImplementation(async () => {
      tableWhenFetching = store.dataContextName;
      return ok([{ name: "Phrases", title: "My Phrases" }]);
    });

    expect(await startCodapSync(store)).toBe(true);
    expect(tableWhenFetching).toBe("Phrases");
    expect(store.dataContextName).toBe("Phrases");
    expect(store.phraseAttributeName).toBe("phrase");
    expect(store.labelAttributeName).toBe("group");
  });

  it("retries init when it fails", async () => {
    api.codapInterface.init
      .mockRejectedValueOnce(new Error("timeout"))
      .mockRejectedValueOnce(new Error("timeout"))
      .mockResolvedValueOnce(savedSelections);

    expect(await startCodapSync(store)).toBe(true);
    expect(api.codapInterface.init).toHaveBeenCalledTimes(kMaxInitAttempts);
    expect(store.dataContextName).toBe("Phrases");
  });

  it("stops without fetching or saving when every init attempt fails", async () => {
    api.codapInterface.init.mockRejectedValue(new Error("timeout"));

    expect(await startCodapSync(store)).toBe(false);
    expect(api.codapInterface.init).toHaveBeenCalledTimes(kMaxInitAttempts);
    expect(consoleError).toHaveBeenCalledWith("Unable to connect to CODAP:", "timeout");
    expect(api.getListOfDataContexts).not.toHaveBeenCalled();
    expect(api.addDataContextsListListener).not.toHaveBeenCalled();
    expect(stateHandler()()).toEqual({ success: true });
  });

  it("lists the tables, using the name when a table has no title", async () => {
    await startCodapSync(store);
    expect(store.dataContexts).toEqual([
      { name: "Phrases", title: "My Phrases" },
      { name: "Other", title: "Other" }
    ]);
  });

  it("clears a restored table, and its columns, that is no longer in the document", async () => {
    api.codapInterface.init.mockResolvedValue(savedSelections);
    delete codapDocument.Phrases;

    await startCodapSync(store);
    expect(store.dataContextName).toBeUndefined();
    expect(store.phraseAttributeName).toBeUndefined();
    expect(store.labelAttributeName).toBeUndefined();
    expect(store.attributes).toEqual([]);
  });

  it("lists leaf columns for Phrase and all columns for Label", async () => {
    api.codapInterface.init.mockResolvedValue(savedSelections);
    await startCodapSync(store);

    expect(store.attributes).toEqual([
      { name: "group", title: "GROUP", collectionName: "Groups", isLeaf: false },
      { name: "phrase", title: "PHRASE", collectionName: "Cases", isLeaf: true },
      { name: "label", title: "LABEL", collectionName: "Cases", isLeaf: true }
    ]);
    expect(store.phraseAttributes.map(attr => attr.name)).toEqual(["phrase", "label"]);
    expect(store.labelAttributes.map(attr => attr.name)).toEqual(["group", "phrase", "label"]);
  });

  it("fetches the columns when a table is selected", async () => {
    await startCodapSync(store);
    store.setDataContext("Other");
    await flush();
    expect(store.attributes.map(attr => attr.name)).toEqual(["text"]);
  });

  it("clears restored column selections that their dropdowns no longer offer", async () => {
    // "group" can't be a phrase because it isn't in the leaf collection, and "label" was deleted
    codapDocument.Phrases.collections.Cases = ["phrase"];
    api.codapInterface.init.mockResolvedValue({ ...savedSelections, phraseAttributeName: "group",
      labelAttributeName: "label" });

    await startCodapSync(store);
    expect(store.dataContextName).toBe("Phrases");
    expect(store.phraseAttributeName).toBeUndefined();
    expect(store.labelAttributeName).toBeUndefined();
  });

  it("ignores a column response for a table that is no longer selected", async () => {
    await startCodapSync(store);
    const slow = deferred<IResult>();
    api.getCollectionList.mockImplementationOnce(() => slow.promise);

    store.setDataContext("Phrases");   // slow response
    store.setDataContext("Other");     // fast response
    await flush();
    expect(store.attributes.map(attr => attr.name)).toEqual(["text"]);

    slow.resolve(ok([{ name: "Cases" }]));
    await flush();
    expect(store.attributes.map(attr => attr.name)).toEqual(["text"]);
    // It doesn't ask for the columns of a table that is no longer selected
    expect(api.getAttributeList).not.toHaveBeenCalledWith("Phrases", "Cases");
  });

  it("never offers the old table's columns for a new table, while loading or after a failure", async () => {
    api.codapInterface.init.mockResolvedValue(savedSelections);
    await startCodapSync(store);
    expect(store.attributes).not.toEqual([]);
    const slow = deferred<IResult>();
    api.getCollectionList.mockImplementationOnce(() => slow.promise);

    store.setDataContext("Other");
    expect(store.attributes).toEqual([]);

    slow.resolve({ success: false, values: { error: "not found" } });
    await flush();
    expect(store.attributes).toEqual([]);
  });

  it("keeps the column list when a refresh for the same table fails", async () => {
    api.codapInterface.init.mockResolvedValue(savedSelections);
    await startCodapSync(store);
    const columns = store.attributes;
    api.getCollectionList.mockResolvedValueOnce({ success: false, values: { error: "busy" } });

    notify(tableListener("Phrases"), "createAttributes");
    await flush();
    expect(store.attributes).toEqual(columns);
    expect(store.phraseAttributeName).toBe("phrase");
  });

  it("ignores a table list that arrives after a newer one", async () => {
    const slow = deferred<IResult>();
    api.getListOfDataContexts.mockImplementationOnce(() => slow.promise);

    const started = startCodapSync(store);
    await flush();
    // A table is added while the startup fetch of the table list is still waiting
    codapDocument.Added = { collections: { Items: ["x"] } };
    const [documentListener] = api.addDataContextsListListener.mock.calls[0];
    notify(documentListener, "dataContextCountChanged", "documentChangeNotice");
    await flush();
    expect(store.dataContexts.map(dc => dc.name)).toEqual(["Phrases", "Other", "Added"]);

    slow.resolve(ok([{ name: "Phrases", title: "My Phrases" }]));
    await started;
    expect(store.dataContexts.map(dc => dc.name)).toEqual(["Phrases", "Other", "Added"]);
  });

  it("ignores a column list that arrives after a newer selection", async () => {
    await startCodapSync(store);
    const slow = deferred<IResult>();
    api.getAttributeList.mockImplementationOnce(() => slow.promise);

    store.setDataContext("Other");     // its attribute list is slow
    await flush();
    store.setDataContext(undefined);
    await flush();
    expect(store.attributes).toEqual([]);

    slow.resolve(ok([{ name: "text" }]));
    await flush();
    expect(store.attributes).toEqual([]);
  });

  it("ignores a stale response after a notice for the restored table", async () => {
    api.codapInterface.init.mockResolvedValue(savedSelections);
    const slow = deferred<IResult>();
    api.getCollectionList.mockImplementationOnce(() => slow.promise);

    const started = startCodapSync(store);
    await flush();
    // A column is added while the first column fetch is still waiting
    codapDocument.Phrases.collections.Cases.push("notes");
    notify(tableListener("Phrases"), "createAttributes");
    await flush();
    expect(store.attributes.map(attr => attr.name)).toContain("notes");

    slow.resolve(ok([{ name: "Groups" }]));
    await started;
    expect(store.attributes.map(attr => attr.name)).toContain("notes");
    expect(store.phraseAttributeName).toBe("phrase");
  });

  it("refetches columns on a column notice for the selected table, and clears a removed selection", async () => {
    api.codapInterface.init.mockResolvedValue(savedSelections);
    await startCodapSync(store);

    // Regrouping moves "phrase" up to the parent collection, so it can't be a phrase
    codapDocument.Phrases.collections = { Groups: ["group", "phrase"], Cases: ["label"] };
    notify(tableListener("Phrases"), "moveAttribute");
    await flush();
    expect(store.phraseAttributeName).toBeUndefined();
    expect(store.labelAttributeName).toBe("group");
  });

  it("ignores case and selection notices", async () => {
    api.codapInterface.init.mockResolvedValue(savedSelections);
    await startCodapSync(store);
    api.getCollectionList.mockClear();

    notify(tableListener("Phrases"), "selectCases");
    notify(tableListener("Phrases"), "updateCases");
    await flush();
    expect(api.getCollectionList).not.toHaveBeenCalled();
  });

  it("ignores column notices for a table that is not selected", async () => {
    api.codapInterface.init.mockResolvedValue(savedSelections);
    await startCodapSync(store);
    api.getCollectionList.mockClear();

    notify(tableListener("Other"), "createAttributes");
    await flush();
    expect(api.getCollectionList).not.toHaveBeenCalled();
  });

  it("refreshes the table list when any table is renamed", async () => {
    await startCodapSync(store);
    codapDocument.Other.title = "Renamed";
    notify(tableListener("Other"), "updateDataContext");
    await flush();
    expect(store.dataContexts).toContainEqual({ name: "Other", title: "Renamed" });
  });

  it("refreshes the table list when a table is added or removed, and watches each table once", async () => {
    api.codapInterface.init.mockResolvedValue(savedSelections);
    await startCodapSync(store);
    const [documentListener] = api.addDataContextsListListener.mock.calls[0];

    codapDocument.Added = { collections: { Items: ["x"] } };
    notify(documentListener, "dataContextCountChanged", "documentChangeNotice");
    await flush();
    expect(store.dataContexts.map(dc => dc.name)).toEqual(["Phrases", "Other", "Added"]);
    // tableListener checks each table has exactly one listener
    tableListener("Phrases");
    tableListener("Added");

    delete codapDocument.Phrases;
    notify(documentListener, "dataContextDeleted", "documentChangeNotice");
    await flush();
    expect(store.dataContextName).toBeUndefined();
    expect(store.attributes).toEqual([]);
  });
});
