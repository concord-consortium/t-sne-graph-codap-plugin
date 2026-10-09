import { Instance, SnapshotIn, types } from "mobx-state-tree";
import { IPosition } from "../tsne/layout";
import { groupLabels, ILabelEntry, kUnlabeledColor } from "../tsne/labels";
import { randomSeed } from "../tsne/random";

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

// A leaf case of the selected table, as fetched from CODAP: its own values and those of its
// parent cases, by attribute name
export interface CaseInfo {
  caseId: string;
  values: Record<string, unknown>;
}

// One phrase to plot: a leaf case of the selected table
export interface Row {
  caseId: string;
  phrase: string;
  // undefined when no Label Column is chosen
  label?: string;
}

// A row's place in the layout, in the unit square
export interface Point extends IPosition {
  caseId: string;
}

export type ComputeStatus = "idle" | "computing" | "done" | "too-few" | "error";

export interface LabelEntry extends ILabelEntry {
  // True when every row with this label is selected
  isSelected: boolean;
}

// The snapshot format. Change it, with a preProcessSnapshot migration, only after the plugin is
// released and only for changes that old snapshots can't load into; a new optional field needs
// neither (doc/plans/README.md §3.4).
export const kStoreVersion = 1;

// A CODAP value as text: labels are text even in a numeric column
const toText = (value: unknown) => value == null ? "" : String(value);

// Inputs are saved in the CODAP document; lists fetched from CODAP and the graph data are volatile
// and never saved
export const PluginStore = types
  .model("PluginStore", {
    version: types.optional(types.number, kStoreVersion),
    dataContextName: types.maybe(types.string),
    phraseAttributeName: types.maybe(types.string),
    labelAttributeName: types.maybe(types.string),
    // Seeds the t-SNE layout, so a saved document shows the same picture when reopened
    tsneSeed: types.maybe(types.number)
  })
  .volatile(() => ({
    dataContexts: [] as DataContextInfo[],
    attributes: [] as AttributeInfo[],
    cases: [] as CaseInfo[],
    points: [] as Point[],
    computeStatus: "idle" as ComputeStatus,
    // CODAP's selected case ids, as strings. Replaced, never changed in place, so views update.
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
    // The phrases to plot, read from the cases by the chosen column names, so choosing a different
    // Phrase or Label Column needs no new fetch. Rows with a blank phrase are skipped.
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
    // The Key's entries, in order, each marked selected when all its rows are selected
    get labelEntries(): LabelEntry[] {
      const { entries, rowKeys } = self.labelGroups;
      const unselectedKeys = new Set(
        rowKeys.filter((_key, i) => !self.isSelected(self.rows[i].caseId)));
      return entries.map(entry => ({ ...entry, isSelected: !unselectedKeys.has(entry.key) }));
    },
    get colorByCaseId() {
      const { entries, rowKeys } = self.labelGroups;
      const colorByKey = new Map(entries.map(entry => [entry.key, entry.color]));
      return new Map(self.rows.map((row, i) => [row.caseId, colorByKey.get(rowKeys[i]) ?? kUnlabeledColor]));
    }
  }))
  .views(self => ({
    colorForCase(caseId: string) {
      return self.colorByCaseId.get(caseId) ?? kUnlabeledColor;
    }
  }))
  .actions(self => {
    const clearLayout = () => {
      self.points = [];
      self.computeStatus = "idle";
    };
    // Creates the seed if the document has none; an existing seed is kept for good
    const ensureTsneSeed = () => {
      if (self.tsneSeed === undefined) self.tsneSeed = randomSeed();
    };

    return {
      ensureTsneSeed,
      // Choosing a different table resets both column selections and drops the graph data
      setDataContext(name: string | undefined) {
        if (name === self.dataContextName) return;
        self.dataContextName = name;
        self.phraseAttributeName = undefined;
        self.labelAttributeName = undefined;
        clearLayout();
        // The cases and selected case ids belong to the old table
        self.cases = [];
        self.selectedCaseIds = new Set();
      },
      setPhraseAttribute(name: string | undefined) {
        self.phraseAttributeName = name;
        if (name === undefined) {
          // The rows view is empty without a Phrase Column; the cases are kept for the same table
          clearLayout();
        } else {
          ensureTsneSeed();
        }
      },
      setLabelAttribute(name: string | undefined) {
        self.labelAttributeName = name;
      },
      setDataContexts(dataContexts: DataContextInfo[]) {
        self.dataContexts = dataContexts;
      },
      setAttributes(attributes: AttributeInfo[]) {
        self.attributes = attributes;
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
