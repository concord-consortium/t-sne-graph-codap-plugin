import { Instance, SnapshotIn, types } from "mobx-state-tree";

// A table in the CODAP document, as listed by getListOfDataContexts
export interface DataContextInfo {
  name: string;
  title: string;
}

// An attribute (column) of the selected table
export interface AttributeInfo {
  name: string;
  title: string;
  collectionName: string;
  // True for columns of the last (child-most) collection, which has one case per row
  isLeaf: boolean;
}

// Inputs are saved in the CODAP document; lists fetched from CODAP are volatile and never saved
export const PluginStore = types
  .model("PluginStore", {
    version: types.optional(types.number, 1),
    dataContextName: types.maybe(types.string),
    phraseAttributeName: types.maybe(types.string),
    labelAttributeName: types.maybe(types.string)
  })
  .volatile(() => ({
    dataContexts: [] as DataContextInfo[],
    attributes: [] as AttributeInfo[]
  }))
  .views(self => ({
    // Phrase Column lists only leaf columns, so there is one phrase per point
    get phraseAttributes() {
      return self.attributes.filter(attr => attr.isLeaf);
    },
    // Label Column lists columns from all collections
    get labelAttributes() {
      return self.attributes;
    }
  }))
  .actions(self => ({
    // Choosing a different table resets both column selections
    setDataContext(name: string | undefined) {
      if (name === self.dataContextName) return;
      self.dataContextName = name;
      self.phraseAttributeName = undefined;
      self.labelAttributeName = undefined;
    },
    setPhraseAttribute(name: string | undefined) {
      self.phraseAttributeName = name;
    },
    setLabelAttribute(name: string | undefined) {
      self.labelAttributeName = name;
    },
    setDataContexts(dataContexts: DataContextInfo[]) {
      self.dataContexts = dataContexts;
    },
    setAttributes(attributes: AttributeInfo[]) {
      self.attributes = attributes;
    }
  }));

export type IPluginStore = Instance<typeof PluginStore>;
export type IPluginStoreSnapshot = SnapshotIn<typeof PluginStore>;
