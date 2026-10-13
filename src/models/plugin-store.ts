import { Instance, SnapshotIn, types } from "mobx-state-tree";
import { IPosition } from "../tsne/layout";
import { groupLabels, ILabelEntry, kUnlabeled, kUnlabeledColor } from "../tsne/labels";
import { randomSeed } from "../tsne/random";

// A table in the CODAP document, as listed by getListOfDataContexts
export interface DataContextInfo {
  name: string;
  title: string;
}

// An attribute (column) of the selected table
export interface AttributeInfo {
  id: string;
  name: string;
  title: string;
  collectionName: string;
  // True for columns of the last (child-most) collection, which has one case per row
  isLeaf: boolean;
}

// A leaf case with its parents' values merged in, by attribute name
export interface CaseInfo {
  caseId: string;
  values: Record<string, unknown>;
}

export interface Row {
  caseId: string;
  phrase: string;
  // undefined without a Label Column
  label?: string;
}

// In the unit square
export interface Point extends IPosition {
  caseId: string;
}

export type ComputeStatus = "idle" | "computing" | "done" | "too-few" | "error";

export interface LabelEntry extends ILabelEntry {
  // All of the label's rows are selected
  isSelected: boolean;
}

// Bump, with a preProcessSnapshot migration, only after release and only for changes old
// snapshots can't load into.
export const kStoreVersion = 1;

// Values are read as text, even from numeric columns
const toText = (value: unknown) => value == null ? "" : String(value);

// Inputs are saved in the CODAP document; data fetched or computed is volatile and never saved
export const PluginStore = types
  .model("PluginStore", {
    version: types.optional(types.number, kStoreVersion),
    dataContextName: types.maybe(types.string),
    phraseAttributeName: types.maybe(types.string),
    phraseAttributeId: types.maybe(types.string),
    labelAttributeName: types.maybe(types.string),
    labelAttributeId: types.maybe(types.string),
    // Same seed, same picture when the document is reopened
    tsneSeed: types.maybe(types.number)
  })
  .volatile(() => ({
    dataContexts: [] as DataContextInfo[],
    attributes: [] as AttributeInfo[],
    cases: [] as CaseInfo[],
    points: [] as Point[],
    computeStatus: "idle" as ComputeStatus,
    // Replaced, not mutated, so views update
    selectedCaseIds: new Set<string>()
  }))
  .views(self => ({
    // Phrase Column lists only leaf columns, so there is one phrase per point
    get phraseAttributes() {
      return self.attributes.filter(attr => attr.isLeaf);
    },
    // Label Column lists columns from all collections
    get labelAttributes() {
      return self.attributes;
    },
    // Derived, so a column change needs no fetch. Blank phrases are skipped.
    get rows(): Row[] {
      const { phraseAttributeName: phraseName, labelAttributeName: labelName } = self;
      if (!phraseName) return [];
      const rows: Row[] = [];
      self.cases.forEach(({ caseId, values }) => {
        const phrase = toText(values[phraseName]);
        if (phrase.trim() === "") return;
        rows.push(labelName ? { caseId, phrase, label: toText(values[labelName]) } : { caseId, phrase });
      });
      return rows;
    }
  }))
  .views(self => ({
    get labelGroups() {
      return groupLabels(self.rows.map(row => row.label));
    },
    isSelected(caseId: string) {
      return self.selectedCaseIds.has(caseId);
    },
    get hasGraph() {
      return self.points.length > 0;
    }
  }))
  .views(self => ({
    get labelEntries(): LabelEntry[] {
      const { entries, rowKeys } = self.labelGroups;
      const unselectedKeys = new Set(
        rowKeys.filter((_key, i) => !self.isSelected(self.rows[i].caseId)));
      return entries.map(entry => ({ ...entry, isSelected: !unselectedKeys.has(entry.key) }));
    },
    get caseIdsByLabelKey() {
      const { rowKeys } = self.labelGroups;
      const caseIds = new Map<string, string[]>();
      self.rows.forEach((row, i) => {
        const ids = caseIds.get(rowKeys[i]);
        if (ids) ids.push(row.caseId); else caseIds.set(rowKeys[i], [row.caseId]);
      });
      return caseIds;
    },
    get entryByCaseId() {
      const { entries, rowKeys } = self.labelGroups;
      const entryByKey = new Map(entries.map(entry => [entry.key, entry]));
      const byCaseId = new Map<string, ILabelEntry>();
      self.rows.forEach((row, i) => {
        const entry = entryByKey.get(rowKeys[i]);
        if (entry) byCaseId.set(row.caseId, entry);
      });
      return byCaseId;
    }
  }))
  .views(self => ({
    colorForCase(caseId: string) {
      return self.entryByCaseId.get(caseId)?.color ?? kUnlabeledColor;
    },
    labelForCase(caseId: string) {
      return self.entryByCaseId.get(caseId)?.label ?? kUnlabeled;
    }
  }))
  .actions(self => {
    const clearLayout = () => {
      self.points = [];
      self.computeStatus = "idle";
    };
    // An existing seed is never replaced
    const ensureTsneSeed = () => {
      if (self.tsneSeed === undefined) self.tsneSeed = randomSeed();
    };
    const idOf = (name: string | undefined) => self.attributes.find(attr => attr.name === name)?.id;
    const setPhraseAttribute = (name: string | undefined) => {
      self.phraseAttributeName = name;
      self.phraseAttributeId = idOf(name);
      if (name === undefined) {
        // Keep the cases: same table
        clearLayout();
      } else {
        ensureTsneSeed();
      }
    };
    const setLabelAttribute = (name: string | undefined) => {
      self.labelAttributeName = name;
      self.labelAttributeId = idOf(name);
    };

    return {
      ensureTsneSeed,
      // Choosing a different table resets both column selections and the plot data
      setDataContext(name: string | undefined) {
        if (name === self.dataContextName) return;
        self.dataContextName = name;
        self.phraseAttributeName = undefined;
        self.phraseAttributeId = undefined;
        self.labelAttributeName = undefined;
        self.labelAttributeId = undefined;
        clearLayout();
        self.cases = [];
        self.selectedCaseIds = new Set();
      },
      setPhraseAttribute,
      setLabelAttribute,
      setDataContexts(dataContexts: DataContextInfo[]) {
        self.dataContexts = dataContexts;
      },
      setAttributes(attributes: AttributeInfo[]) {
        self.attributes = attributes;
      },
      /**
       * Finds each chosen column in the column list by its ID, or by name if no ID was saved, and
       * follows a rename. Clears a choice that its dropdown no longer offers.
       */
      updateAttributeChoices() {
        const find = (offered: AttributeInfo[], name?: string, id?: string) => name === undefined
          ? undefined
          : offered.find(attr => id === undefined ? attr.name === name : attr.id === id);
        const phrase = find(self.phraseAttributes, self.phraseAttributeName, self.phraseAttributeId);
        const label = find(self.labelAttributes, self.labelAttributeName, self.labelAttributeId);

        // Rename the keys in the cases already fetched, so the rows, and so the plot, stay the same
        const newNames = new Map<string, string>();
        if (phrase && self.phraseAttributeName) newNames.set(self.phraseAttributeName, phrase.name);
        if (label && self.labelAttributeName) newNames.set(self.labelAttributeName, label.name);
        if ([...newNames].some(([oldName, newName]) => oldName !== newName)) {
          self.cases = self.cases.map(({ caseId, values }) => {
            const renamed: Record<string, unknown> = {};
            Object.keys(values).forEach(key => { renamed[newNames.get(key) ?? key] = values[key]; });
            return { caseId, values: renamed };
          });
        }

        if (phrase) {
          self.phraseAttributeName = phrase.name;
          self.phraseAttributeId = phrase.id;
        } else {
          setPhraseAttribute(undefined);
        }
        if (label) {
          self.labelAttributeName = label.name;
          self.labelAttributeId = label.id;
        } else {
          setLabelAttribute(undefined);
        }
      },
      setCases(cases: CaseInfo[]) {
        self.cases = cases;
      },
      setPoints(points: Point[]) {
        self.points = points;
      },
      setComputeStatus(status: ComputeStatus) {
        self.computeStatus = status;
      },
      setSelectedCaseIds(caseIds: Iterable<string>) {
        self.selectedCaseIds = new Set(caseIds);
      }
    };
  });

export type IPluginStore = Instance<typeof PluginStore>;
export type IPluginStoreSnapshot = SnapshotIn<typeof PluginStore>;
