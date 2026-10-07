import { applySnapshot, getSnapshot } from "mobx-state-tree";
import { AttributeInfo, PluginStore } from "./plugin-store";

const kAttributes: AttributeInfo[] = [
  { name: "group", title: "Group", collectionName: "Groups", isLeaf: false },
  { name: "phrase", title: "Phrase", collectionName: "Phrases", isLeaf: true },
  { name: "label", title: "Label", collectionName: "Phrases", isLeaf: true }
];

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
      labelAttributeName: undefined
    });
    expect(store.dataContexts).toEqual([]);
    expect(store.attributes).toEqual([]);
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

  it("lists only leaf attributes for Phrase Column and all attributes for Label Column", () => {
    const store = PluginStore.create();
    store.setAttributes(kAttributes);
    expect(store.phraseAttributes.map(attr => attr.name)).toEqual(["phrase", "label"]);
    expect(store.labelAttributes.map(attr => attr.name)).toEqual(["group", "phrase", "label"]);
  });

  it("leaves the lists fetched from CODAP out of the snapshot", () => {
    const store = selectedStore();
    store.setDataContexts([{ name: "Phrases", title: "Phrases" }]);
    store.setAttributes(kAttributes);
    expect(getSnapshot(store)).toEqual({
      version: 1,
      dataContextName: "Phrases",
      phraseAttributeName: "phrase",
      labelAttributeName: "label"
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
