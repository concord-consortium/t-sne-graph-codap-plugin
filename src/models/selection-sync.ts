import { reaction } from "mobx";
import {
  addCasesToSelection, ClientNotification, codapInterface, getSelectionList, selectCases
} from "@concord-consortium/codap-plugin-api";
import { IPluginStore } from "./plugin-store";

// CODAP is the source of truth for the selection (CODAP-1571 plan §4.2 step 8). The plugin reads
// CODAP's selection list into the store, and asks CODAP to change it; it never changes the store's
// copy itself, so the graph and the table can't disagree.

// An item of a selectionList reply
interface ISelectionItem {
  caseID: number | string;
}

const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error);

/**
 * Keeps store.selectedCaseIds equal to CODAP's selection in the selected table: read after each
 * case fetch and on each selectCases notice. Returns a function that stops the reading after a
 * fetch; the notice listener can't be removed, and checks the selected table when it runs.
 */
export const startSelectionSync = (store: IPluginStore) => {
  // Each read takes a new number; a reply is used only if no newer read was started
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

  // One listener for every table ("*" matches any resource), registered once. selectCases notices
  // arrive on the table's own channel, dataContextChangeNotice[name].
  codapInterface.on("notify", "*", "selectCases", (notice: ClientNotification) => {
    if (notice.resource === `dataContextChangeNotice[${store.dataContextName}]`) {
      refreshSelection();
    }
    return { success: true };
  });

  // After each case fetch, including the first after a restore and the empty list when a table
  // is cleared
  return reaction(() => store.cases, () => { refreshSelection(); });
};

/**
 * Asks CODAP to select these leaf cases: instead of the current selection, or added to it when
 * `extend` is true (shift-click). The store changes when CODAP's notice arrives.
 */
export const selectInCodap = async (store: IPluginStore, caseIds: string[], extend = false) => {
  const dataContextName = store.dataContextName;
  if (!dataContextName) return;
  try {
    await (extend ? addCasesToSelection : selectCases)(dataContextName, caseIds);
  } catch (error) {
    console.error("Unable to select cases in", dataContextName, errorMessage(error));
  }
};

/**
 * Asks CODAP to clear the selection in the selected table, parent cases included.
 */
export const clearCodapSelection = (store: IPluginStore) => selectInCodap(store, []);
