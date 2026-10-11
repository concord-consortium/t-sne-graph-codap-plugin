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

/** Mirrors CODAP's selection into the store. The returned function stops only the reads after
 * case fetches; the notice listener can't be removed. */
export const startSelectionSync = (store: IPluginStore) => {
  // Replies to older reads are ignored
  let selectionRequest = 0;

  // `replacing`: after a non-extending notice
  const refreshSelection = async (replacing = false) => {
    const request = ++selectionRequest;
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
      if (replacing && caseIds.length > 0 && store.selectedSlots === slotsAtStart) store.setSelectedSlots([]);
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

const requestCodapSelection = async (store: IPluginStore, caseIds: string[], extend: boolean) => {
  const dataContextName = store.dataContextName;
  if (!dataContextName) return;
  try {
    await (extend ? addCasesToSelection : selectCases)(dataContextName, caseIds);
  } catch (error) {
    console.error("Unable to select cases in", dataContextName, errorMessage(error));
  }
};

/** Adds to the selection when `extend` is true; otherwise replaces it, test phrases included. The
 * store's cases follow CODAP's notice. */
export const selectInCodap = (store: IPluginStore, caseIds: string[], extend = false) => {
  if (!extend) store.setSelectedSlots([]);
  return requestCodapSelection(store, caseIds, extend);
};

/** Follows CODAP's graph: a selected point stays selected on a plain click, and Shift removes it. */
export const selectPoint = (store: IPluginStore, caseId: string, extend: boolean) => {
  if (!store.isSelected(caseId)) return selectInCodap(store, [caseId], extend);
  if (!extend) return;
  // The API can only replace or add, so replace with the other selected leaf cases. Parent IDs are
  // left out: CODAP would select all their children again.
  const others = store.cases
    .filter(({ caseId: id }) => id !== caseId && store.isSelected(id))
    .map(({ caseId: id }) => id);
  return selectInCodap(store, others);
};

/** Test phrases and parent cases too. */
export const clearCodapSelection = (store: IPluginStore) => selectInCodap(store, []);

/** Plain: this slot alone, no cases. `extend` adds the slot without asking CODAP. */
export const selectTestPhrase = async (store: IPluginStore, slot: number, extend = false) => {
  if (extend) {
    store.setSelectedSlots([...store.selectedSlots, slot]);
    return;
  }
  store.setSelectedSlots([slot]);
  await requestCodapSelection(store, [], false);
};
