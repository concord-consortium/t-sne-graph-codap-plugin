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
      if (request !== selectionRequest || !result.success) return;
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

/** Adds to the selection when `extend` is true. The store follows CODAP's notice. */
export const selectInCodap = async (store: IPluginStore, caseIds: string[], extend = false) => {
  const dataContextName = store.dataContextName;
  if (!dataContextName) return;
  try {
    await (extend ? addCasesToSelection : selectCases)(dataContextName, caseIds);
  } catch (error) {
    console.error("Unable to select cases in", dataContextName, errorMessage(error));
  }
};

/** Parent-case selections are cleared too. */
export const clearCodapSelection = (store: IPluginStore) => selectInCodap(store, []);
