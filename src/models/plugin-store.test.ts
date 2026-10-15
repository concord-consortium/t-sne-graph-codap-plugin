import { applySnapshot, getSnapshot } from "mobx-state-tree";
import { kLabelColors, kUnlabeledColor } from "../tsne/labels";
import { kFitView, kMaxZoomLevel, kMinZoomLevel, kZoomFactor } from "../tsne/layout";
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
      testPhrases: ["", "", "", "", ""],
      view: { zoomLevel: 0, centerX: 0.5, centerY: 0.5 }
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
      testPhrases: ["a cat", "", "", "", ""],
      view: { zoomLevel: 0, centerX: 0.5, centerY: 0.5 }
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

  describe("and the view", () => {
    const zoomed = { zoomLevel: 2, centerX: 0.2, centerY: 0.7 };
    const zoomedChoicesStore = () => {
      const store = choicesStore();
      store.zoomIn();
      store.zoomIn();
      store.panTo(zoomed.centerX, zoomed.centerY);
      return store;
    };

    it("keeps the view when a chosen column is renamed: same column, same picture", () => {
      const store = zoomedChoicesStore();
      store.setAttributes(rename(rename(kAttributes, "2", "text"), "1", "category"));
      store.updateAttributeChoices();
      expect(store.phraseAttributeName).toBe("text");
      expect(store.view).toEqual(zoomed);
    });

    it("resets the view when the Phrase Column is gone", () => {
      const store = zoomedChoicesStore();
      store.setAttributes(kAttributes.filter(attr => attr.id !== "2"));
      store.updateAttributeChoices();
      expect(store.phraseAttributeName).toBeUndefined();
      expect(store.view).toEqual(kFitView);
    });

    it("keeps the view when only the Label Column is gone", () => {
      const store = zoomedChoicesStore();
      store.setAttributes(kAttributes.filter(attr => attr.id !== "1"));
      store.updateAttributeChoices();
      expect(store.labelAttributeName).toBeUndefined();
      expect(store.view).toEqual(zoomed);
    });
  });
});

describe("PluginStore snapshot version", () => {
  it("stays 1: tsneSeed is optional, so a snapshot without it loads as is", () => {
    expect(kStoreVersion).toBe(1);
    const saved = { version: 1, dataContextName: "Phrases", phraseAttributeName: "phrase" };
    const store = PluginStore.create();
    applySnapshot(store, saved);
    expect(getSnapshot(store)).toEqual({ ...saved, labelAttributeName: undefined, tsneSeed: undefined,
      testPhrases: ["", "", "", "", ""], view: { zoomLevel: 0, centerX: 0.5, centerY: 0.5 } });
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

  it("gives each case its label's tooltip fill, the Unlabeled one for a blank or unknown case", () => {
    const store = graphStore();
    expect(kCaseIds.map(caseId => store.tooltipFillForCase(caseId)))
      .toEqual(["#c0cfff", "#ffbfb2", "#c0cfff", "#d1d1d1"]);
    expect(store.tooltipFillForCase("99")).toBe("#d1d1d1");
  });

  it("mixes a tooltip fill for a fifth label", () => {
    const store = graphStore();
    store.setCases(["a", "b", "c", "d", "e"].map((label, i) =>
      ({ caseId: `${i + 1}`, values: { phrase: `phrase ${i}`, label } })));
    expect(store.tooltipFillForCase("5")).toBe(`color-mix(in srgb, ${kLabelColors[4]} 35%, white)`);
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

  it("truncates a saved phrase to 255 characters, on create and on restore", () => {
    const long = "x".repeat(300);
    const store = PluginStore.create({ testPhrases: [long, "short"] });
    expect(store.testPhrases[0]).toBe("x".repeat(kMaxTestPhraseLength));
    expect(store.testPhrases[1]).toBe("short");
    const restored = PluginStore.create();
    applySnapshot(restored, { version: 1, testPhrases: [long, "short"] });
    expect(restored.testPhrases[0]).toBe("x".repeat(kMaxTestPhraseLength));
    expect(restored.testPhrases[1]).toBe("short");
  });

  it("commits a phrase trimmed, with each run of whitespace made one space", () => {
    const store = PluginStore.create();
    store.setTestPhrase(1, "  the \t cat\n\nsat  ");
    expect(store.testPhrases[1]).toBe("the cat sat");
    store.setTestPhrase(1, " \t ");
    expect(store.testPhrases[1]).toBe("");
  });

  it.each([null, "abc", 7, { 0: "the cat" }])(
    "loads %j as five empty phrases and keeps the rest of the saved state", testPhrases => {
      const store = PluginStore.create();
      const saved = { version: 1, dataContextName: "Phrases", phraseAttributeName: "phrase", tsneSeed: 12345 };
      applySnapshot(store, { ...saved, testPhrases } as unknown as typeof saved);
      expect(store.testPhrases).toEqual(["", "", "", "", ""]);
      expect(store.dataContextName).toBe("Phrases");
      expect(store.phraseAttributeName).toBe("phrase");
      expect(store.tsneSeed).toBe(12345);
    });

  it("normalizes saved phrases as a commit does", () => {
    const store = PluginStore.create();
    applySnapshot(store, { version: 1, testPhrases: ["  the  cat ", "   ", "a\tdog"] });
    expect(store.testPhrases).toEqual(["the cat", "", "a dog", "", ""]);
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

  it("keeps placements when the same table or another Phrase Column is chosen, or the Label Column is cleared", () => {
    const store = placedStore();
    store.setDataContext("Phrases");
    store.setPhraseAttribute("notes");
    store.setLabelAttribute(undefined);
    expect(store.testPhrasePoints).toHaveLength(2);
    expect(store.isSlotSelected(0)).toBe(true);
  });
});

describe("PluginStore view", () => {
  const zoomedStore = () => {
    const store = selectedStore();
    store.zoomIn();
    store.zoomIn();
    store.panTo(0.2, 0.7);
    return store;
  };
  const restore = (view: unknown) =>
    PluginStore.create({ version: 1, view } as unknown as Parameters<typeof PluginStore.create>[0]).view;

  it("starts at the fit view, with zoom in and out allowed", () => {
    const store = PluginStore.create();
    expect(store.view).toEqual(kFitView);
    expect(store.scale).toBe(1);
    expect(store.isFitView).toBe(true);
    expect(store.canZoomIn).toBe(true);
    expect(store.canZoomOut).toBe(true);
  });

  it("zooms in and out one level at a time, about the same center", () => {
    const store = PluginStore.create();
    store.panTo(0.3, 0.6);
    store.zoomIn();
    expect(store.view).toEqual({ zoomLevel: 1, centerX: 0.3, centerY: 0.6 });
    expect(store.scale).toBe(kZoomFactor);
    store.zoomOut();
    store.zoomOut();
    expect(store.view).toEqual({ zoomLevel: -1, centerX: 0.3, centerY: 0.6 });
  });

  it("returns exactly to fit after the same number of clicks in and out", () => {
    const store = PluginStore.create();
    store.zoomIn();
    store.zoomIn();
    store.zoomIn();
    store.zoomOut();
    store.zoomOut();
    store.zoomOut();
    expect(store.isFitView).toBe(true);
  });

  it("stops at the largest zoom", () => {
    const store = PluginStore.create();
    for (let i = 0; i < kMaxZoomLevel + 3; i++) store.zoomIn();
    expect(store.view.zoomLevel).toBe(kMaxZoomLevel);
    expect(store.canZoomIn).toBe(false);
    expect(store.canZoomOut).toBe(true);
  });

  it("stops at the smallest zoom", () => {
    const store = PluginStore.create();
    for (let i = 0; i < 5; i++) store.zoomOut();
    expect(store.view.zoomLevel).toBe(kMinZoomLevel);
    expect(store.canZoomOut).toBe(false);
    expect(store.canZoomIn).toBe(true);
  });

  it("pans within [0, 1]", () => {
    const store = PluginStore.create();
    store.panTo(0.25, 0.8);
    expect(store.view).toEqual({ zoomLevel: 0, centerX: 0.25, centerY: 0.8 });
    store.panTo(-1, 3);
    expect(store.view).toEqual({ zoomLevel: 0, centerX: 0, centerY: 1 });
  });

  it("is not the fit view after a pan at level 0", () => {
    const store = PluginStore.create();
    store.panTo(0.5, 0.6);
    expect(store.view.zoomLevel).toBe(0);
    expect(store.isFitView).toBe(false);
  });

  it("returns to the fit view on fitAll and resetView", () => {
    const store = zoomedStore();
    store.fitAll();
    expect(store.view).toEqual(kFitView);
    store.zoomIn();
    store.resetView();
    expect(store.view).toEqual(kFitView);
  });

  it("round-trips the view through a snapshot", () => {
    const saved = getSnapshot(zoomedStore());
    expect(saved.view).toEqual({ zoomLevel: 2, centerX: 0.2, centerY: 0.7 });
    const store = PluginStore.create();
    applySnapshot(store, saved);
    expect(store.view).toEqual({ zoomLevel: 2, centerX: 0.2, centerY: 0.7 });
  });

  it("loads a snapshot without a view at the fit view", () => {
    const store = PluginStore.create({ version: 1, dataContextName: "Phrases" });
    expect(store.view).toEqual(kFitView);
  });

  it("clamps and rounds a saved level that is out of range or not an integer", () => {
    expect(restore({ zoomLevel: 99, centerX: 0.5, centerY: 0.5 }).zoomLevel).toBe(kMaxZoomLevel);
    expect(restore({ zoomLevel: -99, centerX: 0.5, centerY: 0.5 }).zoomLevel).toBe(kMinZoomLevel);
    expect(restore({ zoomLevel: 2.4, centerX: 0.5, centerY: 0.5 }).zoomLevel).toBe(2);
  });

  it("loads a saved center that is a string, NaN or out of range as a usable one", () => {
    expect(restore({ zoomLevel: 1, centerX: "0.3", centerY: 0.4 }))
      .toEqual({ zoomLevel: 1, centerX: 0.5, centerY: 0.4 });
    expect(restore({ zoomLevel: 1, centerX: 0.3, centerY: NaN })).toEqual({ zoomLevel: 1, centerX: 0.3, centerY: 0.5 });
    expect(restore({ zoomLevel: 1, centerX: -2, centerY: 7 })).toEqual({ zoomLevel: 1, centerX: 0, centerY: 1 });
  });

  it("loads a saved view that is not an object at the fit view", () => {
    expect(restore("zoomed")).toEqual(kFitView);
    expect(restore(null)).toEqual(kFitView);
  });

  it("resets on a table change", () => {
    const store = zoomedStore();
    store.setDataContext("Other");
    expect(store.view).toEqual(kFitView);
  });

  it("resets when the Phrase Column is cleared", () => {
    const store = zoomedStore();
    store.setPhraseAttribute(undefined);
    expect(store.view).toEqual(kFitView);
  });

  it("resets when a different Phrase Column is chosen", () => {
    const store = zoomedStore();
    store.setPhraseAttribute("label");
    expect(store.view).toEqual(kFitView);
  });

  it("keeps the view when the same table or Phrase Column is set again", () => {
    const store = zoomedStore();
    store.setDataContext("Phrases");
    store.setPhraseAttribute("phrase");
    expect(store.view).toEqual({ zoomLevel: 2, centerX: 0.2, centerY: 0.7 });
  });

  it("keeps the view on a Label Column change", () => {
    const store = zoomedStore();
    store.setLabelAttribute(undefined);
    store.setLabelAttribute("group");
    expect(store.view).toEqual({ zoomLevel: 2, centerX: 0.2, centerY: 0.7 });
  });

  it("keeps a restored view: applySnapshot does not go through the column actions", () => {
    const saved = getSnapshot(zoomedStore());
    const store = selectedStore();
    applySnapshot(store, { ...saved, dataContextName: "Other", phraseAttributeName: "label" });
    expect(store.view).toEqual({ zoomLevel: 2, centerX: 0.2, centerY: 0.7 });
  });
});
