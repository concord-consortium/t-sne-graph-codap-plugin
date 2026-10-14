import { reaction } from "mobx";
import {
  addCasesToSelection, ClientNotification, codapInterface, getSelectionList, selectCases
} from "@concord-consortium/codap-plugin-api";
import { IPluginStore } from "./plugin-store";

// CODAP owns the case selection; the store only mirrors it. The plugin owns the test-phrase (slot)
// selection and sets it as the action happens. Notices carry no origin, so one only clears slots,
// and only when a later action must have replaced them.

interface ISelectionItem {
  caseID: number | string;
}

interface ISelectCasesNotice {
  operation?: string;
  result?: { extend?: boolean };
}

const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error);

// The one notice the plugin recognizes as its own: removing a point replaces CODAP's selection, and
// that notice looks like a table click, which would unselect the test phrases. selectPoint records
// the leaf cases it asked for; the next replacing notice uses the record up.
const expectedRemovals = new WeakMap<IPluginStore, Set<string>>();

const isExpectedRemoval = (store: IPluginStore, expected: Set<string> | undefined, caseIds: string[]) => {
  if (!expected) return false;
  // CODAP adds a parent whose children are all selected, so compare leaf cases only
  const leafIds = new Set(store.cases.map(({ caseId }) => caseId));
  const selectedLeaves = caseIds.filter(id => leafIds.has(id));
  return selectedLeaves.length === expected.size && selectedLeaves.every(id => expected.has(id));
};

/** Mirrors CODAP's selection into the store. The returned function stops only the reads after
 * case fetches; the notice listener can't be removed. */
export const startSelectionSync = (store: IPluginStore) => {
  // Replies to older reads are ignored
  let selectionRequest = 0;

  // `replacing`: after a non-extending notice
  const refreshSelection = async (replacing = false) => {
    const request = ++selectionRequest;
    const expected = replacing ? expectedRemovals.get(store) : undefined;
    if (replacing) expectedRemovals.delete(store);
    // Slots selected during the read are a later action, so keep them. setSelectedSlots always
    // stores a new Set.
    const slotsAtStart = store.selectedSlots;
    const dataContextName = store.dataContextName;
    if (!dataContextName) {
      store.setSelectedCaseIds([]);
      return;
    }
    try {
      const result = await getSelectionList(dataContextName);
      if (request !== selectionRequest) return;
      if (!result.success) throw new Error(String(result.values?.error ?? "request failed"));
      const caseIds = (result.values as ISelectionItem[]).map(item => String(item.caseID));
      store.setSelectedCaseIds(caseIds);
      // A slot select leaves CODAP empty, so a non-empty replacement came after it
      if (replacing && caseIds.length > 0 && store.selectedSlots === slotsAtStart &&
        !isExpectedRemoval(store, expected, caseIds)) {
        store.setSelectedSlots([]);
      }
    } catch (error) {
      console.error("Unable to get the selection of", dataContextName, errorMessage(error));
    }
  };

  // One listener for every table: "*" matches any resource
  codapInterface.on("notify", "*", "selectCases", (notice: ClientNotification) => {
    if (notice.resource === `dataContextChangeNotice[${store.dataContextName}]`) {
      const { result } = (notice.values ?? {}) as ISelectCasesNotice;
      refreshSelection(result?.extend !== true);
    }
    return { success: true };
  });

  return reaction(() => store.cases, () => { refreshSelection(); });
};

/** Whether CODAP took the request. A refusal can be thrown or returned. */
const requestCodapSelection = async (store: IPluginStore, caseIds: string[], extend: boolean) => {
  const dataContextName = store.dataContextName;
  if (!dataContextName) return false;
  try {
    const result = await (extend ? addCasesToSelection : selectCases)(dataContextName, caseIds);
    if (result?.success === false) throw new Error(String(result.values?.error ?? "request failed"));
    return true;
  } catch (error) {
    console.error("Unable to select cases in", dataContextName, errorMessage(error));
    return false;
  }
};

/** Adds to the selection when `extend` is true; otherwise replaces it, test phrases included. The
 * store's cases follow CODAP's notice. */
export const selectInCodap = (store: IPluginStore, caseIds: string[], extend = false) => {
  if (!extend) store.setSelectedSlots([]);
  return requestCodapSelection(store, caseIds, extend);
};

/** Follows CODAP's graph: a selected point stays selected on a plain click, and Shift removes it. */
export const selectPoint = async (store: IPluginStore, caseId: string, extend: boolean) => {
  if (!store.isSelected(caseId)) return selectInCodap(store, [caseId], extend);
  if (!extend) return;
  // The API can only replace or add, so replace with the other selected leaf cases. Parent IDs are
  // left out: CODAP would select all their children again.
  const others = store.cases
    .filter(({ caseId: id }) => id !== caseId && store.isSelected(id))
    .map(({ caseId: id }) => id);
  // A removal keeps the test phrases, as Shift does elsewhere
  const expected = store.selectedSlots.size > 0 && others.length > 0 ? new Set(others) : undefined;
  if (expected) expectedRemovals.set(store, expected);
  const accepted = await requestCodapSelection(store, others, false);
  // A refused request sends no notice, so the record would wait for an unrelated one
  if (!accepted && expected && expectedRemovals.get(store) === expected) expectedRemovals.delete(store);
};

/** Test phrases and parent cases too. */
export const clearCodapSelection = (store: IPluginStore) => selectInCodap(store, []);

/** Follows selectPoint: a selected slot stays selected on a plain select, and `extend` removes it.
 * Otherwise a plain select is this slot alone, no cases, and `extend` adds it. `extend` never asks
 * CODAP. */
export const selectTestPhrase = async (store: IPluginStore, slot: number, extend = false) => {
  const selected = store.isSlotSelected(slot);
  if (extend) {
    const others = [...store.selectedSlots].filter(other => other !== slot);
    store.setSelectedSlots(selected ? others : [...others, slot]);
    return;
  }
  if (selected) return;
  store.setSelectedSlots([slot]);
  await requestCodapSelection(store, [], false);
};
