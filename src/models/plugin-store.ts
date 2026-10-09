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

// Labels are text even in numeric columns
const toText = (value: unknown) => value == null ? "" : String(value);

// Inputs are saved in the CODAP document; data fetched or computed is volatile and never saved
export const PluginStore = types
  .model("PluginStore", {
    version: types.optional(types.number, kStoreVersion),
    dataContextName: types.maybe(types.string),
    phraseAttributeName: types.maybe(types.string),
    labelAttributeName: types.maybe(types.string),
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
    // An existing seed is never replaced
    const ensureTsneSeed = () => {
      if (self.tsneSeed === undefined) self.tsneSeed = randomSeed();
    };

    return {
      ensureTsneSeed,
      // Choosing a different table resets both column selections and the graph data
      setDataContext(name: string | undefined) {
        if (name === self.dataContextName) return;
        self.dataContextName = name;
        self.phraseAttributeName = undefined;
        self.labelAttributeName = undefined;
        clearLayout();
        self.cases = [];
        self.selectedCaseIds = new Set();
      },
      setPhraseAttribute(name: string | undefined) {
        self.phraseAttributeName = name;
        if (name === undefined) {
          // Keep the cases: same table
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
