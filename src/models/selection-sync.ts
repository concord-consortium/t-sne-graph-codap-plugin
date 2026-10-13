import { reaction } from "mobx";
import {
  addCasesToSelection, ClientNotification, codapInterface, getSelectionList, selectCases
} from "@concord-consortium/codap-plugin-api";
import { IPluginStore } from "./plugin-store";

// CODAP owns the selection: the plugin reads it and asks CODAP to change it, never changing the
// store's copy itself.

interface ISelectionItem {
  caseID: number | string;
}

const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error);

/** Mirrors CODAP's selection into the store. The returned function stops only the reads after
 * case fetches; the notice listener can't be removed. */
export const startSelectionSync = (store: IPluginStore) => {
  // Replies to older reads are ignored
  let selectionRequest = 0;

  const refreshSelection = async () => {
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
      store.setSelectedCaseIds((result.values as ISelectionItem[]).map(item => String(item.caseID)));
    } catch (error) {
      console.error("Unable to get the selection of", dataContextName, errorMessage(error));
    }
  };

  // One listener for every table: "*" matches any resource
  codapInterface.on("notify", "*", "selectCases", (notice: ClientNotification) => {
    if (notice.resource === `dataContextChangeNotice[${store.dataContextName}]`) {
      refreshSelection();
    }
    return { success: true };
  });

  return reaction(() => store.cases, () => { refreshSelection(); });
};

/** Adds to the selection when `extend` is true. */
export const selectInCodap = async (store: IPluginStore, caseIds: string[], extend = false) => {
  const dataContextName = store.dataContextName;
  if (!dataContextName) return;
  try {
    await (extend ? addCasesToSelection : selectCases)(dataContextName, caseIds);
  } catch (error) {
    console.error("Unable to select cases in", dataContextName, errorMessage(error));
  }
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

/** Parent-case selections are cleared too. */
export const clearCodapSelection = (store: IPluginStore) => selectInCodap(store, []);
