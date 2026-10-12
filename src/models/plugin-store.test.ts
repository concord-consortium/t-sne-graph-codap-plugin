import { applySnapshot, getSnapshot } from "mobx-state-tree";
import { kLabelColors, kUnlabeledColor } from "../tsne/labels";
import {
  AttributeInfo, CaseInfo, kMaxTestPhraseLength, kStoreVersion, PluginStore, TestPhrasePoint
} from "./plugin-store";

const kAttributes: AttributeInfo[] = [
  { id: "1", name: "group", title: "Group", collectionName: "Groups", isLeaf: false },
  { id: "2", name: "phrase", title: "Phrase", collectionName: "Phrases", isLeaf: true },
  { id: "3", name: "label", title: "Label", collectionName: "Phrases", isLeaf: true }
];

// "group" comes from the parent case
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
      tsneSeed: undefined,
      testPhrases: ["", "", "", "", ""]
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

  it("leaves the lists fetched from CODAP and the plot data out of the snapshot", () => {
    const store = selectedStore();
    store.setDataContexts([{ name: "Phrases", title: "Phrases" }]);
    store.setAttributes(kAttributes);
    store.setCases(kCases);
    store.setPoints([{ caseId: "1", x: 0.5, y: 0.5 }]);
    store.setComputeStatus("done");
    store.setSelectedCaseIds(["1"]);
    store.setTestPhrase(0, "a cat");
    store.setTestPhrasePoints(
      [{ slot: 0, x: 0.5, y: 0.5, neighborCaseId: "1", direction: { dx: 1, dy: 0 } }], { 0: "placed" });
    store.setEditingSlot(0);
    store.setSelectedSlots([0]);
    expect(getSnapshot(store)).toEqual({
      version: 1,
      dataContextName: "Phrases",
      phraseAttributeName: "phrase",
      labelAttributeName: "label",
      tsneSeed: expect.any(Number),
      testPhrases: ["a cat", "", "", "", ""]
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

describe("PluginStore column choices", () => {
  const choicesStore = () => {
    const store = PluginStore.create();
    store.setDataContext("Phrases");
    store.setAttributes(kAttributes);
    store.setPhraseAttribute("phrase");
    store.setLabelAttribute("group");
    store.setCases(kCases);
    return store;
  };
  const rename = (attributes: AttributeInfo[], id: string, name: string) =>
    attributes.map(attr => attr.id === id ? { ...attr, name } : attr);

  it("saves the ID of each chosen column", () => {
    expect(getSnapshot(choicesStore())).toMatchObject({
      phraseAttributeName: "phrase", phraseAttributeId: "2", labelAttributeName: "group", labelAttributeId: "1"
    });
  });

  it("follows renamed columns without changing the rows", () => {
    const store = choicesStore();
    const rows = store.rows;
    store.setAttributes(rename(rename(kAttributes, "2", "text"), "1", "category"));
    store.updateAttributeChoices();
    expect(store.phraseAttributeName).toBe("text");
    expect(store.labelAttributeName).toBe("category");
    expect(store.cases[0].values).toEqual({ category: "A", text: "the cat sat", label: "Similar", notes: "first" });
    expect(store.rows).toEqual(rows);
  });

  it("follows a column given the name of another column that was renamed", () => {
    const store = choicesStore();
    const rows = store.rows;
    // "phrase" and "label" swap names
    store.setAttributes(rename(rename(kAttributes, "2", "label"), "3", "phrase"));
    store.updateAttributeChoices();
    expect(store.phraseAttributeName).toBe("label");
    expect(store.cases[0].values).toEqual({ group: "A", label: "the cat sat", notes: "first" });
    expect(store.rows).toEqual(rows);
  });

  it("finds a choice saved without an ID by its name, and saves the ID", () => {
    const store = PluginStore.create({ dataContextName: "Phrases", phraseAttributeName: "phrase" });
    store.setAttributes(kAttributes);
    store.updateAttributeChoices();
    expect(store.phraseAttributeName).toBe("phrase");
    expect(store.phraseAttributeId).toBe("2");
  });

  it("clears a choice whose column is gone, even if a new column has its name", () => {
    const store = choicesStore();
    store.setAttributes(kAttributes.map(attr => attr.id === "2" ? { ...attr, id: "4" } : attr));
    store.updateAttributeChoices();
    expect(store.phraseAttributeName).toBeUndefined();
    expect(store.phraseAttributeId).toBeUndefined();
    expect(store.labelAttributeName).toBe("group");
  });

  it("clears a Phrase Column that moves to a parent collection", () => {
    const store = choicesStore();
    store.setAttributes(kAttributes.map(attr => attr.id === "2" ? { ...attr, isLeaf: false } : attr));
    store.updateAttributeChoices();
    expect(store.phraseAttributeName).toBeUndefined();
  });
});

describe("PluginStore snapshot version", () => {
  it("stays 1: tsneSeed is optional, so a snapshot without it loads as is", () => {
    expect(kStoreVersion).toBe(1);
    const saved = { version: 1, dataContextName: "Phrases", phraseAttributeName: "phrase" };
    const store = PluginStore.create();
    applySnapshot(store, saved);
    expect(getSnapshot(store)).toEqual({ ...saved, labelAttributeName: undefined, tsneSeed: undefined,
      testPhrases: ["", "", "", "", ""] });
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

describe("PluginStore plot data", () => {
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

  it("keeps the plot data when the same table is selected again", () => {
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

  it("has a plot only while there are points", () => {
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

  it("gives each case its label's color, and gray for an unknown case", () => {
    const store = graphStore();
    expect(kCaseIds.map(caseId => store.colorForCase(caseId))).toEqual(
      [kLabelColors[0], kLabelColors[1], kLabelColors[0], kUnlabeledColor]);
    expect(store.colorForCase("99")).toBe(kUnlabeledColor);
  });

  it("gives each case its label's Key text, and Unlabeled for a blank or unknown case", () => {
    const store = graphStore();
    expect(kCaseIds.map(caseId => store.labelForCase(caseId))).toEqual(["Similar", "Opposite", "Similar", "Unlabeled"]);
    expect(store.labelForCase("99")).toBe("Unlabeled");
  });

  it("recolors at once when the Label Column changes", () => {
    const store = graphStore();
    store.setLabelAttribute(undefined);
    expect(store.labelEntries.map(entry => [entry.label, entry.count])).toEqual([["Unlabeled", 4]]);
    expect(kCaseIds.map(caseId => store.colorForCase(caseId))).toEqual(kCaseIds.map(() => kUnlabeledColor));
  });

  it("lists the case IDs of each label, Unlabeled under the empty key", () => {
    const store = graphStore();
    expect(Array.from(store.caseIdsByLabelKey.entries())).toEqual([
      ["similar", ["1", "3"]], ["opposite", ["2"]], ["", ["4"]]
    ]);
  });

  it("matches selection by case ID", () => {
    const store = graphStore();
    expect(store.isSelected("2")).toBe(true);
    expect(store.isSelected("1")).toBe(false);
    store.setSelectedCaseIds([]);
    expect(store.isSelected("2")).toBe(false);
  });
});

describe("PluginStore test phrases", () => {
  const point = (slot: number): TestPhrasePoint =>
    ({ slot, x: 0.5, y: 0.5, neighborCaseId: "1", direction: { dx: 1, dy: 0 } });

  // Slots 0 and 2 have phrases, both placed; slot 0 is selected
  const placedStore = () => {
    const store = selectedStore();
    store.setCases(kCases);
    store.setTestPhrase(0, "the cat");
    store.setTestPhrase(2, "a dog");
    store.setTestPhrasePoints([point(0), point(2)], { 0: "placed", 1: "empty", 2: "placed", 3: "empty", 4: "empty" });
    store.setSelectedSlots([0]);
    return store;
  };

  it("starts with five empty phrases and nothing placed, edited or selected", () => {
    const store = PluginStore.create();
    expect(store.testPhrases).toEqual(["", "", "", "", ""]);
    expect(store.testPhrasePoints).toEqual([]);
    expect(store.placementStatus).toEqual({});
    expect(store.editingSlot).toBeUndefined();
    expect(store.selectedSlots.size).toBe(0);
  });

  it("loads a snapshot without test phrases as five empty ones, at version 1", () => {
    const store = PluginStore.create();
    applySnapshot(store, { version: 1, dataContextName: "Phrases", phraseAttributeName: "phrase", tsneSeed: 3 });
    expect(store.testPhrases).toEqual(["", "", "", "", ""]);
    expect(store.version).toBe(1);
  });

  it("restores saved test phrases", () => {
    const saved = getSnapshot(placedStore());
    const store = PluginStore.create();
    applySnapshot(store, saved);
    expect(store.testPhrases).toEqual(["the cat", "", "a dog", "", ""]);
  });

  it.each([
    [[], ["", "", "", "", ""]],
    [["a", "b", "c"], ["a", "b", "c", "", ""]],
    [["a", "b", "c", "d", "e"], ["a", "b", "c", "d", "e"]],
    [["a", "b", "c", "d", "e", "f", "g"], ["a", "b", "c", "d", "e"]]
  ])("loads %j as exactly five phrases", (testPhrases, expected) => {
    expect(PluginStore.create({ testPhrases }).testPhrases).toEqual(expected);
    const store = PluginStore.create();
    applySnapshot(store, { version: 1, testPhrases });
    expect(store.testPhrases).toEqual(expected);
  });

  it("truncates a saved phrase to 255 characters", () => {
    const long = "x".repeat(300);
    const store = PluginStore.create({ testPhrases: [long, "short"] });
    expect(store.testPhrases[0]).toBe("x".repeat(kMaxTestPhraseLength));
    expect(store.testPhrases[1]).toBe("short");
  });

  it("commits a phrase trimmed, with each run of whitespace made one space", () => {
    const store = PluginStore.create();
    store.setTestPhrase(1, "  the \t cat\n\nsat  ");
    expect(store.testPhrases[1]).toBe("the cat sat");
    store.setTestPhrase(1, " \t ");
    expect(store.testPhrases[1]).toBe("");
  });

  it("loads a saved entry that is not text as an empty phrase", () => {
    const store = PluginStore.create();
    applySnapshot(store, { version: 1, testPhrases: [null, 7, "a dog"] as unknown as string[] });
    expect(store.testPhrases).toEqual(["", "", "a dog", "", ""]);
  });

  it("never cuts an emoji in half at the 255 cap, on load or on commit", () => {
    // 254 units + a 2-unit emoji
    const long = `${"a".repeat(254)}😀`;
    expect(PluginStore.create({ testPhrases: [long] }).testPhrases[0]).toBe("a".repeat(254));
    const store = PluginStore.create();
    store.setTestPhrase(0, long);
    expect(store.testPhrases[0]).toBe("a".repeat(254));
  });

  it("can cut a longer character, such as a flag, at the 255 cap", () => {
    // 253 units + a 4-unit flag: its first half stays
    const store = PluginStore.create();
    store.setTestPhrase(0, `${"a".repeat(253)}🇺🇸`);
    expect(store.testPhrases[0]).toBe(`${"a".repeat(253)}🇺`);
  });

  it("caps a committed phrase at 255 characters", () => {
    const store = PluginStore.create();
    store.setTestPhrase(0, "y".repeat(300));
    expect(store.testPhrases[0]).toHaveLength(kMaxTestPhraseLength);
  });

  it("drops the slot's point, status and selection on a changed commit", () => {
    const store = placedStore();
    store.setTestPhrase(0, "the kitten");
    expect(store.testPhrases[0]).toBe("the kitten");
    expect(store.testPhrasePoints.map(({ slot }) => slot)).toEqual([2]);
    expect(store.placementStatus).toEqual({ 1: "empty", 2: "placed", 3: "empty", 4: "empty" });
    expect(store.isSlotSelected(0)).toBe(false);
  });

  it("drops only the slot's own selection on a changed commit", () => {
    const store = placedStore();
    store.setSelectedSlots([0, 2]);
    store.setTestPhrase(2, "");
    expect([...store.selectedSlots]).toEqual([0]);
  });

  it("does nothing on an unchanged commit, including one that differs only in spaces", () => {
    const store = placedStore();
    const { testPhrasePoints, placementStatus, selectedSlots } = store;
    store.setTestPhrase(0, "the cat");
    store.setTestPhrase(0, "  the   cat ");
    expect(store.testPhrasePoints).toBe(testPhrasePoints);
    expect(store.placementStatus).toBe(placementStatus);
    expect(store.selectedSlots).toBe(selectedSlots);
  });

  it("ignores a slot outside 0 to 4", () => {
    const store = PluginStore.create();
    store.setTestPhrase(5, "the cat");
    store.setTestPhrase(-1, "the cat");
    expect(store.testPhrases).toEqual(["", "", "", "", ""]);
  });

  it("replaces every slot's placement from one reply", () => {
    const store = placedStore();
    store.setTestPhrasePoints([point(2)], { 0: "no-words", 1: "empty", 2: "placed", 3: "empty", 4: "empty" });
    expect(store.testPhrasePoints).toEqual([point(2)]);
    expect(store.placementStatus[0]).toBe("no-words");
  });

  it("lists the placed slots, leaving out the one being edited", () => {
    const store = placedStore();
    expect([...store.placedSlots]).toEqual([0, 2]);
    store.setEditingSlot(2);
    expect([...store.placedSlots]).toEqual([0]);
    // Kept, so an unchanged commit shows it again
    expect(store.testPhrasePoints).toHaveLength(2);
    store.setEditingSlot(undefined);
    expect([...store.placedSlots]).toEqual([0, 2]);
  });

  it("matches slot selection by slot", () => {
    const store = placedStore();
    expect(store.isSlotSelected(0)).toBe(true);
    expect(store.isSlotSelected(2)).toBe(false);
    store.setSelectedSlots([2]);
    expect(store.isSlotSelected(0)).toBe(false);
    expect(store.isSlotSelected(2)).toBe(true);
  });

  it("gives each slot its symbol, in order", () => {
    const store = PluginStore.create();
    expect([0, 1, 2, 3, 4].map(slot => store.symbolForSlot(slot)))
      .toEqual(["square", "triangle", "diamond", "plus", "star"]);
  });

  it("drops placements and slot selection, but keeps the phrases, when a different table is selected", () => {
    const store = placedStore();
    store.setDataContext("Other");
    expect(store.testPhrases).toEqual(["the cat", "", "a dog", "", ""]);
    expect(store.testPhrasePoints).toEqual([]);
    expect(store.placementStatus).toEqual({});
    expect(store.selectedSlots.size).toBe(0);
  });

  it("drops placements and slot selection, but keeps the phrases, when the Phrase Column is cleared", () => {
    const store = placedStore();
    store.setPhraseAttribute(undefined);
    expect(store.testPhrases).toEqual(["the cat", "", "a dog", "", ""]);
    expect(store.testPhrasePoints).toEqual([]);
    expect(store.placementStatus).toEqual({});
    expect(store.selectedSlots.size).toBe(0);
  });

  it("keeps placements when the same table, another Phrase Column or a Label Column is chosen", () => {
    const store = placedStore();
    store.setDataContext("Phrases");
    store.setPhraseAttribute("notes");
    store.setLabelAttribute(undefined);
    expect(store.testPhrasePoints).toHaveLength(2);
    expect(store.isSlotSelected(0)).toBe(true);
  });
});
