import { Instance, SnapshotIn, types } from "mobx-state-tree";
import {
  clampView, IDirection, IPosition, IView, kFitView, kMaxZoomLevel, kMinZoomLevel, scaleForLevel
} from "../tsne/layout";
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

// In slot order
export const kPhraseSymbols = ["square", "triangle", "diamond", "plus", "star"] as const;
export type PhraseSymbol = typeof kPhraseSymbols[number];
export const kTestPhraseSlots = kPhraseSymbols.length;
// A sanity bound, not a product rule
export const kMaxTestPhraseLength = 255;

// Unit-square units; jitter can put it slightly outside [0, 1]
export interface TestPhrasePoint extends IPosition {
  slot: number;
  neighborCaseId: string;
  // Unit vector away from the neighbor
  direction: IDirection;
}

// No status: waiting for placement
export type PlacementStatus = "placed" | "no-words" | "empty";

const emptyTestPhrases = () => new Array<string>(kTestPhraseSlots).fill("");

// Never ends on the first half of a surrogate pair. Longer characters (flags, families) can still be
// cut at the limit; it is only a sanity bound.
const capPhrase = (text: string) => {
  const last = text.charCodeAt(kMaxTestPhraseLength - 1);
  return text.slice(0, last >= 0xd800 && last <= 0xdbff ? kMaxTestPhraseLength - 1 : kMaxTestPhraseLength);
};

// "" always means no phrase
export const normalizeTestPhrase = (text: string) =>
  capPhrase(text.trim().replace(/\s+/g, " "));

// Always five phrases, whatever a saved document holds. Each is cleaned up as a typed phrase is:
// trimmed, with each run of spaces made one space, and cut to 255 characters. Anything but a list
// gives five empty phrases; MST would reject it, and the whole saved state with it.
const normalizeTestPhrases = (phrases: unknown) => Array.isArray(phrases)
  ? emptyTestPhrases().map((empty, slot) => {
    const phrase: unknown = phrases[slot];
    return typeof phrase === "string" ? normalizeTestPhrase(phrase) : empty;
  })
  : emptyTestPhrases();

// Whatever a saved document holds: a value that isn't a number becomes the fit view's
const normalizeView = (view: unknown): IView => {
  const { zoomLevel, centerX, centerY } = (view && typeof view === "object" ? view : {}) as Record<string, unknown>;
  const toNumber = (value: unknown) => typeof value === "number" ? value : NaN;
  return clampView({ zoomLevel: toNumber(zoomLevel), centerX: toNumber(centerX), centerY: toNumber(centerY) });
};

// The part of the plot shown; see IView
const View = types.model("View", {
  zoomLevel: types.optional(types.integer, kFitView.zoomLevel),
  centerX: types.optional(types.number, kFitView.centerX),
  centerY: types.optional(types.number, kFitView.centerY)
});

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
    tsneSeed: types.maybe(types.number),
    // Survive table changes: they belong to the document
    testPhrases: types.optional(types.array(types.string), emptyTestPhrases),
    view: types.optional(View, {})
  })
  // Input normalization, not a version migration
  .preProcessSnapshot(snapshot => snapshot && {
    ...snapshot,
    ...("testPhrases" in snapshot ? { testPhrases: normalizeTestPhrases(snapshot.testPhrases) } : {}),
    view: normalizeView(snapshot.view)
  })
  .volatile(() => ({
    dataContexts: [] as DataContextInfo[],
    attributes: [] as AttributeInfo[],
    cases: [] as CaseInfo[],
    points: [] as Point[],
    computeStatus: "idle" as ComputeStatus,
    // Replaced, not mutated, so views update
    selectedCaseIds: new Set<string>(),
    // Only placed slots
    testPhrasePoints: [] as TestPhrasePoint[],
    placementStatus: {} as Record<number, PlacementStatus>,
    // Its point is hidden while editing
    editingSlot: undefined as number | undefined,
    // Plugin-owned, since test phrases aren't CODAP cases. Replaced, not mutated.
    selectedSlots: new Set<number>()
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
    },
    // Placed and not being edited
    get placedSlots() {
      return new Set(self.testPhrasePoints.map(point => point.slot).filter(slot => slot !== self.editingSlot));
    },
    isSlotSelected(slot: number) {
      return self.selectedSlots.has(slot);
    },
    symbolForSlot(slot: number): PhraseSymbol {
      return kPhraseSymbols[slot];
    },
    get scale() {
      return scaleForLevel(self.view.zoomLevel);
    },
    get isFitView() {
      const { zoomLevel, centerX, centerY } = self.view;
      return zoomLevel === kFitView.zoomLevel && centerX === kFitView.centerX && centerY === kFitView.centerY;
    },
    get canZoomIn() {
      return self.view.zoomLevel < kMaxZoomLevel;
    },
    get canZoomOut() {
      return self.view.zoomLevel > kMinZoomLevel;
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
      // The phrases stay
      self.testPhrasePoints = [];
      self.placementStatus = {};
      self.selectedSlots = new Set();
    };
    // An existing seed is never replaced
    const ensureTsneSeed = () => {
      if (self.tsneSeed === undefined) self.tsneSeed = randomSeed();
    };
    const setView = (view: IView) => {
      const { zoomLevel, centerX, centerY } = clampView(view);
      self.view.zoomLevel = zoomLevel;
      self.view.centerX = centerX;
      self.view.centerY = centerY;
    };
    // An old view of a different picture is never kept
    const resetView = () => setView(kFitView);
    const idOf = (name: string | undefined) => self.attributes.find(attr => attr.name === name)?.id;
    const setPhraseAttribute = (name: string | undefined) => {
      if (name !== self.phraseAttributeName) resetView();
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
      resetView,
      zoomIn() {
        setView({ ...self.view, zoomLevel: self.view.zoomLevel + 1 });
      },
      zoomOut() {
        setView({ ...self.view, zoomLevel: self.view.zoomLevel - 1 });
      },
      fitAll: resetView,
      panTo(centerX: number, centerY: number) {
        setView({ ...self.view, centerX, centerY });
      },
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
        resetView();
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
          // A key that already has a new name belongs to a column whose name has moved, so it is dropped
          const targets = new Set(newNames.values());
          self.cases = self.cases.map(({ caseId, values }) => {
            const renamed: Record<string, unknown> = {};
            Object.keys(values).forEach(key => {
              const newKey = newNames.get(key);
              if (newKey !== undefined) renamed[newKey] = values[key];
              else if (!targets.has(key)) renamed[key] = values[key];
            });
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
      },
      /** A change drops the slot's point, status and selection, so the old point never shows for the
       * new phrase. */
      setTestPhrase(slot: number, text: string) {
        if (slot < 0 || slot >= kTestPhraseSlots) return;
        const phrase = normalizeTestPhrase(text);
        if (phrase === self.testPhrases[slot]) return;
        self.testPhrases[slot] = phrase;
        self.testPhrasePoints = self.testPhrasePoints.filter(point => point.slot !== slot);
        const { [slot]: _dropped, ...status } = self.placementStatus;
        self.placementStatus = status;
        if (self.selectedSlots.has(slot)) {
          self.selectedSlots = new Set([...self.selectedSlots].filter(selected => selected !== slot));
        }
      },
      setTestPhrasePoints(points: TestPhrasePoint[], status: Record<number, PlacementStatus>) {
        self.testPhrasePoints = points;
        self.placementStatus = status;
      },
      setEditingSlot(slot: number | undefined) {
        self.editingSlot = slot;
      },
      setSelectedSlots(slots: Iterable<number>) {
        self.selectedSlots = new Set(slots);
      }
    };
  });

export type IPluginStore = Instance<typeof PluginStore>;
export type IPluginStoreSnapshot = SnapshotIn<typeof PluginStore>;
