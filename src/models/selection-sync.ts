import { reaction } from "mobx";
import {
  addCasesToSelection, ClientNotification, codapInterface, getSelectionList, selectCases
} from "@concord-consortium/codap-plugin-api";
import { IPluginStore } from "./plugin-store";

// CODAP owns the case selection: the plugin reads it and asks CODAP to change it, never changing
// the store's copy itself. The plugin owns the test-phrase (slot) selection and sets it at once,
// when the action happens. CODAP's notices carry no origin, so the plugin never tries to recognize
// its own; a notice only ever clears slots, and only when a later action must have replaced them.

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

  // `replacing`: the read follows a notice of a selection that replaced the old one
  const refreshSelection = async (replacing = false) => {
    const request = ++selectionRequest;
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
      // A non-empty replacement came after any slot select, whose own clear leaves CODAP empty
      if (replacing && caseIds.length > 0) store.setSelectedSlots([]);
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

/** Adds to the selection when `extend` is true. Otherwise the cases replace everything, so the
 * test phrases are unselected at once. The cases follow CODAP's notice. */
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

/** Test phrases too, and parent-case selections. */
export const clearCodapSelection = (store: IPluginStore) => selectInCodap(store, []);

/** A plain select replaces everything: the slot alone, and no cases. `extend` adds the slot and
 * leaves CODAP alone. */
export const selectTestPhrase = async (store: IPluginStore, slot: number, extend = false) => {
  if (extend) {
    store.setSelectedSlots([...store.selectedSlots, slot]);
    return;
  }
  store.setSelectedSlots([slot]);
  await requestCodapSelection(store, [], false);
};
