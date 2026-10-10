import { Instance, SnapshotIn, types } from "mobx-state-tree";
import { IDirection, IPosition } from "../tsne/layout";
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

// A placed test phrase, in the unit square's units; jitter can put it a little outside [0, 1]
export interface TestPhrasePoint extends IPosition {
  slot: number;
  neighborCaseId: string;
  // Unit direction away from the neighbor, in the unit square
  direction: IDirection;
}

// A slot with no status is waiting for placement
export type PlacementStatus = "placed" | "no-words" | "empty";

const emptyTestPhrases = () => new Array<string>(kTestPhraseSlots).fill("");

// The characters people see. Firefox has it only from version 125.
const kGraphemes = typeof Intl.Segmenter === "function"
  ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
  : null;

/** At most `max` UTF-16 code units, as the field's maxLength counts, without cutting a character in
 * half: not an emoji's two units, and not the parts of a flag emoji (🇺🇸) or a family emoji (👨‍👩‍👧). */
export const truncateText = (text: string, max: number, graphemes: Intl.Segmenter | null = kGraphemes) => {
  if (text.length <= max) return text;
  if (graphemes) {
    let end = 0;
    for (const { index, segment } of graphemes.segment(text)) {
      if (index + segment.length > max) break;
      end = index + segment.length;
    }
    return text.slice(0, end);
  }
  // Without Intl.Segmenter, at least don't end on the first unit of a two-unit character
  const last = text.charCodeAt(max - 1);
  return text.slice(0, last >= 0xd800 && last <= 0xdbff ? max - 1 : max);
};

const isLowSurrogate = (code: number) => code >= 0xdc00 && code <= 0xdfff;

// Where the characters people see start and end in `text`, from 0 to text.length
const characterBoundaries = (text: string, graphemes: Intl.Segmenter | null) => {
  if (graphemes) return [...Array.from(graphemes.segment(text), ({ index }) => index), text.length];
  const boundaries: number[] = [];
  for (let i = 0; i <= text.length; i++) {
    if (!isLowSurrogate(text.charCodeAt(i))) boundaries.push(i);
  }
  return boundaries;
};

/** The edit from `previous` to `next`, kept within `max` the way maxLength keeps it: only the
 * inserted text is cut. Typing into a full field adds nothing; a long paste over a selection keeps
 * the part of it that fits. The inserted text is found as what lies between the start and the end
 * the two share, so where the pasted text repeats its neighbors, the cut can fall a little
 * differently than maxLength's. */
export const fitEdit = (previous: string, next: string, max: number,
  graphemes: Intl.Segmenter | null = kGraphemes) => {
  if (next.length <= max) return next;
  const shortest = Math.min(previous.length, next.length);
  let start = 0;
  while (start < shortest && previous[start] === next[start]) start++;
  let end = next.length;
  while (end > start && next.length - end < shortest - start &&
    previous[previous.length - (next.length - end) - 1] === next[end - 1]) end--;
  // Widen the inserted part to whole characters, so the kept text never holds half of one
  const boundaries = characterBoundaries(next, graphemes);
  let from = 0;
  let to = next.length;
  for (const boundary of boundaries) {
    if (boundary <= start) from = boundary;
    if (boundary >= end) {
      to = boundary;
      break;
    }
  }
  const room = Math.max(0, max - from - (next.length - to));
  const fitted = next.slice(0, from) + truncateText(next.slice(from, to), room, graphemes) + next.slice(to);
  return truncateText(fitted, max, graphemes);
};

// "" always means no phrase
export const normalizeTestPhrase = (text: string) =>
  truncateText(text.trim().replace(/\s+/g, " "), kMaxTestPhraseLength);

// Exactly five strings of at most 255 characters, whatever a saved document holds
const normalizeTestPhrases = (phrases: readonly unknown[]) =>
  emptyTestPhrases().map((empty, slot) => {
    const phrase = phrases[slot];
    return typeof phrase === "string" ? truncateText(phrase, kMaxTestPhraseLength) : empty;
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
    // One per slot; kept when the table changes, since they belong to the document
    testPhrases: types.optional(types.array(types.string), emptyTestPhrases)
  })
  // Input normalization, not a version migration
  .preProcessSnapshot(snapshot => snapshot?.testPhrases
    ? { ...snapshot, testPhrases: normalizeTestPhrases(snapshot.testPhrases) }
    : snapshot)
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
    // Its point is hidden while it is edited
    editingSlot: undefined as number | undefined,
    // Test phrases aren't CODAP cases, so the plugin owns their selection. Replaced, not mutated.
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
    // Slots with a point to draw: placed and not being edited
    get placedSlots() {
      return new Set(self.testPhrasePoints.map(point => point.slot).filter(slot => slot !== self.editingSlot));
    },
    isSlotSelected(slot: number) {
      return self.selectedSlots.has(slot);
    },
    symbolForSlot(slot: number): PhraseSymbol {
      return kPhraseSymbols[slot];
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
      /** Commits a slot's text. A change drops the slot's point, status and selection, so the old
       * point never shows for the new phrase; an unchanged commit does nothing. */
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
      /** Replaces every slot's placement, from one reply. */
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
