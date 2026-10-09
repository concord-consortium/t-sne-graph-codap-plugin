import { applySnapshot, getSnapshot } from "mobx-state-tree";
import { kLabelColors, kUnlabeledColor } from "../tsne/labels";
import { AttributeInfo, CaseInfo, kStoreVersion, PluginStore } from "./plugin-store";

const kAttributes: AttributeInfo[] = [
  { name: "group", title: "Group", collectionName: "Groups", isLeaf: false },
  { name: "phrase", title: "Phrase", collectionName: "Phrases", isLeaf: true },
  { name: "label", title: "Label", collectionName: "Phrases", isLeaf: true }
];

// Leaf cases with their own values and their parent's ("group")
const kCases: CaseInfo[] = [
  { caseId: "1", values: { group: "A", phrase: "the cat sat", label: "Similar", notes: "first" } },
  { caseId: "2", values: { group: "B", phrase: "a dog ran", label: "Opposite", notes: "" } },
  { caseId: "3", values: { group: "A", phrase: "the kitten lay", label: "similar ", notes: 3 } },
  { caseId: "4", values: { group: "B", phrase: "a bird sang", label: "", notes: null } }
];
const kCaseIds = kCases.map(({ caseId }) => caseId);

const selectedStore = () => {
  const store = PluginStore.create();
  store.setDataContext("Phrases");
  store.setPhraseAttribute("phrase");
  store.setLabelAttribute("label");
  return store;
};

describe("PluginStore", () => {
  it("starts with nothing selected", () => {
    const store = PluginStore.create();
    expect(getSnapshot(store)).toEqual({
      version: 1,
      dataContextName: undefined,
      phraseAttributeName: undefined,
      labelAttributeName: undefined,
      tsneSeed: undefined
    });
    expect(store.dataContexts).toEqual([]);
    expect(store.attributes).toEqual([]);
    expect(store.cases).toEqual([]);
    expect(store.rows).toEqual([]);
    expect(store.points).toEqual([]);
    expect(store.computeStatus).toBe("idle");
    expect(store.selectedCaseIds.size).toBe(0);
  });

  it("resets both columns when a different table is selected", () => {
    const store = selectedStore();
    store.setDataContext("Other");
    expect(store.dataContextName).toBe("Other");
    expect(store.phraseAttributeName).toBeUndefined();
    expect(store.labelAttributeName).toBeUndefined();
  });

  it("keeps the columns when the same table is selected again", () => {
    const store = selectedStore();
    store.setDataContext("Phrases");
    expect(store.phraseAttributeName).toBe("phrase");
    expect(store.labelAttributeName).toBe("label");
  });

  it("clears each selection when set to undefined", () => {
    const store = selectedStore();
    store.setLabelAttribute(undefined);
    expect(store.labelAttributeName).toBeUndefined();
    store.setPhraseAttribute(undefined);
    expect(store.phraseAttributeName).toBeUndefined();
    store.setDataContext(undefined);
    expect(store.dataContextName).toBeUndefined();
  });

  it("lists only leaf columns for Phrase Column and all columns for Label Column", () => {
    const store = PluginStore.create();
    store.setAttributes(kAttributes);
    expect(store.phraseAttributes.map(attr => attr.name)).toEqual(["phrase", "label"]);
    expect(store.labelAttributes.map(attr => attr.name)).toEqual(["group", "phrase", "label"]);
  });

  it("leaves the lists fetched from CODAP and the graph data out of the snapshot", () => {
    const store = selectedStore();
    store.setDataContexts([{ name: "Phrases", title: "Phrases" }]);
    store.setAttributes(kAttributes);
    store.setCases(kCases);
    store.setPoints([{ caseId: "1", x: 0.5, y: 0.5 }]);
    store.setComputeStatus("done");
    store.setSelectedCaseIds(["1"]);
    expect(getSnapshot(store)).toEqual({
      version: 1,
      dataContextName: "Phrases",
      phraseAttributeName: "phrase",
      labelAttributeName: "label",
      tsneSeed: expect.any(Number)
    });
  });

  it("restores the selections from a saved snapshot", () => {
    const saved = getSnapshot(selectedStore());
    const store = PluginStore.create();
    applySnapshot(store, saved);
    expect(store.dataContextName).toBe("Phrases");
    expect(store.phraseAttributeName).toBe("phrase");
    expect(store.labelAttributeName).toBe("label");
  });
});

describe("PluginStore snapshot version", () => {
  it("stays 1: tsneSeed is optional, so a snapshot without it loads as is", () => {
    expect(kStoreVersion).toBe(1);
    const saved = { version: 1, dataContextName: "Phrases", phraseAttributeName: "phrase" };
    const store = PluginStore.create();
    applySnapshot(store, saved);
    expect(getSnapshot(store)).toEqual({ ...saved, labelAttributeName: undefined, tsneSeed: undefined });
  });

  it("restores a saved seed", () => {
    const saved = { version: 1, dataContextName: "Phrases", phraseAttributeName: "phrase", tsneSeed: 12345 };
    const store = PluginStore.create();
    applySnapshot(store, saved);
    expect(store.tsneSeed).toBe(12345);
  });
});

describe("PluginStore t-SNE seed", () => {
  let random: jest.SpyInstance;

  beforeEach(() => {
    random = jest.spyOn(Math, "random").mockReturnValue(0.25);
  });

  afterEach(() => {
    random.mockRestore();
  });

  it("is created, as a whole number, when a Phrase Column is first chosen", () => {
    const store = PluginStore.create();
    expect(store.tsneSeed).toBeUndefined();
    store.setDataContext("Phrases");
    expect(store.tsneSeed).toBeUndefined();
    store.setPhraseAttribute("phrase");
    expect(store.tsneSeed).toBe(2 ** 30);
  });

  it("is kept when the Phrase Column or the table changes", () => {
    const store = selectedStore();
    random.mockReturnValue(0.75);
    store.setPhraseAttribute("other");
    store.setPhraseAttribute(undefined);
    store.setDataContext("Other");
    store.setPhraseAttribute("phrase");
    expect(store.tsneSeed).toBe(2 ** 30);
  });

  it("is created by ensureTsneSeed only when missing", () => {
    const store = PluginStore.create();
    store.ensureTsneSeed();
    expect(store.tsneSeed).toBe(2 ** 30);
    random.mockReturnValue(0.75);
    store.ensureTsneSeed();
    expect(store.tsneSeed).toBe(2 ** 30);
  });

  it("is kept from a restored document", () => {
    const store = PluginStore.create({ dataContextName: "Phrases", tsneSeed: 7 });
    store.setPhraseAttribute("phrase");
    store.ensureTsneSeed();
    expect(store.tsneSeed).toBe(7);
  });
});

describe("PluginStore rows", () => {
  const casesStore = () => {
    const store = selectedStore();
    store.setCases(kCases);
    return store;
  };

  it("reads each row's phrase and label from its case by the chosen column names", () => {
    expect(casesStore().rows).toEqual([
      { caseId: "1", phrase: "the cat sat", label: "Similar" },
      { caseId: "2", phrase: "a dog ran", label: "Opposite" },
      { caseId: "3", phrase: "the kitten lay", label: "similar " },
      { caseId: "4", phrase: "a bird sang", label: "" }
    ]);
  });

  it("follows a Label Column change without a new fetch, including a parent-level column", () => {
    const store = casesStore();
    store.setLabelAttribute("group");
    expect(store.rows.map(row => row.label)).toEqual(["A", "B", "A", "B"]);
    expect(store.labelEntries.map(entry => entry.label)).toEqual(["A", "B"]);
  });

  it("gives rows no label when no Label Column is chosen", () => {
    const store = casesStore();
    store.setLabelAttribute(undefined);
    expect(store.rows.map(row => row.label)).toEqual([undefined, undefined, undefined, undefined]);
  });

  it("follows a Phrase Column change, skipping blank phrases and reading values as text", () => {
    const store = casesStore();
    store.setPhraseAttribute("notes");
    // "" and null are blank; 3 becomes "3"
    expect(store.rows.map(({ caseId, phrase }) => [caseId, phrase])).toEqual([["1", "first"], ["3", "3"]]);
  });

  it("skips phrases that are only whitespace", () => {
    const store = selectedStore();
    store.setCases([{ caseId: "1", values: { phrase: "  \t" } }, { caseId: "2", values: { phrase: "ok" } }]);
    expect(store.rows.map(row => row.caseId)).toEqual(["2"]);
  });

  it("is empty without a Phrase Column, and back when one is chosen again", () => {
    const store = casesStore();
    store.setPhraseAttribute(undefined);
    expect(store.rows).toEqual([]);
    store.setPhraseAttribute("phrase");
    expect(store.rows).toHaveLength(4);
  });
});

describe("PluginStore graph data", () => {
  const graphStore = () => {
    const store = selectedStore();
    store.setCases(kCases);
    store.setPoints(kCaseIds.map((caseId, i) => ({ caseId, x: i / 4, y: i / 4 })));
    store.setComputeStatus("done");
    store.setSelectedCaseIds(["2"]);
    return store;
  };

  it("drops cases, points, status and selection when a different table is selected", () => {
    const store = graphStore();
    store.setDataContext("Other");
    expect(store.cases).toEqual([]);
    expect(store.rows).toEqual([]);
    expect(store.points).toEqual([]);
    expect(store.computeStatus).toBe("idle");
    expect(store.selectedCaseIds.size).toBe(0);
  });

  it("keeps the graph data when the same table is selected again", () => {
    const store = graphStore();
    store.setDataContext("Phrases");
    expect(store.rows).toHaveLength(4);
    expect(store.points).toHaveLength(4);
  });

  it("drops points and status, but keeps cases and selection, when the Phrase Column is cleared", () => {
    const store = graphStore();
    store.setPhraseAttribute(undefined);
    expect(store.cases).toHaveLength(4);
    expect(store.points).toEqual([]);
    expect(store.computeStatus).toBe("idle");
    expect(store.isSelected("2")).toBe(true);
  });

  it("keeps the points when a different Phrase Column or Label Column is chosen", () => {
    const store = graphStore();
    store.setPhraseAttribute("notes");
    store.setLabelAttribute(undefined);
    expect(store.points).toHaveLength(4);
  });

  it("has a graph only while there are points", () => {
    const store = graphStore();
    expect(store.hasGraph).toBe(true);
    store.setPoints([]);
    expect(store.hasGraph).toBe(false);
  });

  it("lists the Key entries with Unlabeled first and marks the fully selected ones", () => {
    const store = graphStore();
    expect(store.labelEntries).toEqual([
      { key: "", label: "Unlabeled", color: kUnlabeledColor, count: 1, isSelected: false },
      { key: "similar", label: "Similar", color: kLabelColors[0], count: 2, isSelected: false },
      { key: "opposite", label: "Opposite", color: kLabelColors[1], count: 1, isSelected: true }
    ]);
  });

  it("marks a label selected only when all its rows are selected", () => {
    const store = graphStore();
    store.setSelectedCaseIds(["1"]);
    expect(store.labelEntries.find(entry => entry.key === "similar")?.isSelected).toBe(false);
    store.setSelectedCaseIds(["1", "3"]);
    expect(store.labelEntries.find(entry => entry.key === "similar")?.isSelected).toBe(true);
  });

  it("gives each case its label's color, and grey for an unknown case", () => {
    const store = graphStore();
    expect(kCaseIds.map(caseId => store.colorForCase(caseId))).toEqual(
      [kLabelColors[0], kLabelColors[1], kLabelColors[0], kUnlabeledColor]);
    expect(store.colorForCase("99")).toBe(kUnlabeledColor);
  });

  it("recolors at once when the Label Column changes", () => {
    const store = graphStore();
    store.setLabelAttribute(undefined);
    expect(store.labelEntries.map(entry => [entry.label, entry.count])).toEqual([["Unlabeled", 4]]);
    expect(kCaseIds.map(caseId => store.colorForCase(caseId))).toEqual(kCaseIds.map(() => kUnlabeledColor));
  });

  it("matches selection by case id", () => {
    const store = graphStore();
    expect(store.isSelected("2")).toBe(true);
    expect(store.isSelected("1")).toBe(false);
    store.setSelectedCaseIds([]);
    expect(store.isSelected("2")).toBe(false);
  });
});
