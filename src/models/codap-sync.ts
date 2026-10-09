import { reaction } from "mobx";
import { applySnapshot, getSnapshot, onSnapshot } from "mobx-state-tree";
import {
  addDataContextChangeListener,
  addDataContextsListListener,
  codapInterface,
  getAttributeList,
  getCollectionList,
  getListOfDataContexts,
  IConfig,
  sendMessage
} from "@concord-consortium/codap-plugin-api";
import { AttributeInfo, CaseInfo, DataContextInfo, IPluginStore } from "./plugin-store";

// CODAP v3 applies the dimensions to the whole tile, including its 34px title bar
const kContentSize = { width: 680, height: 300 };
const kTitleBarHeight = 34;

// The plugin's name is the tile title
export const kPluginConfig: IConfig = {
  name: "t-SNE Plot",
  version: "0.0.1",
  dimensions: { width: kContentSize.width, height: kContentSize.height + kTitleBarHeight }
};

export const kMaxInitAttempts = 3;

// Notices that change cases but not columns
const kCaseOperations = new Set(["createCases", "updateCases", "deleteCases", "moveCases", "dependentCases"]);

interface INamedItem {
  name: string;
  title?: string;
}

// A case in an allCases reply. Ids are numbers; a leaf case has no children.
interface IAllCasesItem {
  case: {
    id: number | string;
    parent?: number | string;
    values: Record<string, unknown>;
  };
}

const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error);

/**
 * Connects to CODAP, restores the saved selections, and keeps the table and column lists and the
 * selected table's cases current.
 * Resolves to false if every init attempt fails, in which case nothing else is started.
 */
export const startCodapSync = async (store: IPluginStore, config = kPluginConfig): Promise<boolean> => {
  let isRestored = false;
  // A saved state that couldn't be restored, given back to CODAP unchanged until the user changes
  // a selection, so a save doesn't replace it with the default store
  let unreadableState: unknown;

  // CODAP saves whatever value this returns. Answering with no value until restore finishes keeps
  // the document's saved state instead of overwriting it with the default store.
  codapInterface.on("get", "interactiveState", () => (
    isRestored ? { success: true, values: unreadableState ?? getSnapshot(store) } : { success: true }
  ));

  // 1. Connect, retrying a bounded number of times
  let savedState: unknown;
  for (let attempt = 1; ; attempt++) {
    try {
      savedState = await codapInterface.init({ ...config, customInteractiveStateHandler: true });
      break;
    } catch (error) {
      if (attempt >= kMaxInitAttempts) {
        console.error("Unable to connect to CODAP:", errorMessage(error));
        return false;
      }
    }
  }

  // 2. Restore before any fetch, so the fetches validate the saved selections
  if (savedState && typeof savedState === "object") {
    try {
      applySnapshot(store, savedState);
    } catch (error) {
      console.error("Unable to restore saved state:", errorMessage(error));
      // applySnapshot can apply part of a bad snapshot before it throws
      applySnapshot(store, {});
      unreadableState = savedState;
      const stopWatching = onSnapshot(store, () => {
        unreadableState = undefined;
        stopWatching();
      });
    }
  }
  isRestored = true;

  // Each fetch takes a new request number; a response is applied only if no newer request was made
  let dataContextsRequest = 0;
  let attributesRequest = 0;
  let casesRequest = 0;

  const refreshAttributes = async () => {
    const request = ++attributesRequest;
    const dataContextName = store.dataContextName;
    if (!dataContextName) {
      store.setAttributes([]);
      return;
    }
    try {
      const collectionsResult = await getCollectionList(dataContextName);
      if (request !== attributesRequest || !collectionsResult.success) return;
      const collections: INamedItem[] = collectionsResult.values;
      const attributeResults = await Promise.all(
        collections.map(collection => getAttributeList(dataContextName, collection.name))
      );
      if (request !== attributesRequest || attributeResults.some(result => !result.success)) return;

      // Collections are listed parent first, so the last one is the leaf
      const attributes: AttributeInfo[] = [];
      collections.forEach((collection, index) => {
        (attributeResults[index].values as INamedItem[]).forEach(attr => attributes.push({
          name: attr.name,
          title: attr.title || attr.name,
          collectionName: collection.name,
          isLeaf: index === collections.length - 1
        }));
      });
      store.setAttributes(attributes);
      // Clear any selection its dropdown no longer offers
      if (!store.phraseAttributes.some(attr => attr.name === store.phraseAttributeName)) {
        store.setPhraseAttribute(undefined);
      }
      if (!store.labelAttributes.some(attr => attr.name === store.labelAttributeName)) {
        store.setLabelAttribute(undefined);
      }
    } catch (error) {
      console.error("Unable to get the columns of", dataContextName, errorMessage(error));
    }
  };

  // Fetches every case of the selected table and stores one record per leaf case, holding its own
  // values and those of its parent cases. Collections are listed parent first, so each parent's
  // values are known before its children are read.
  const refreshCases = async () => {
    const request = ++casesRequest;
    const dataContextName = store.dataContextName;
    if (!dataContextName) {
      store.setCases([]);
      return;
    }
    try {
      const collectionsResult = await getCollectionList(dataContextName);
      if (request !== casesRequest || !collectionsResult.success) return;
      const collections: INamedItem[] = collectionsResult.values;
      const caseResults = await Promise.all(collections.map(collection =>
        sendMessage("get", `dataContext[${dataContextName}].collection[${collection.name}].allCases`)));
      if (request !== casesRequest || caseResults.some(result => !result.success)) return;

      // Each case's values merged with its parents', by case ID
      const valuesById = new Map<string, Record<string, unknown>>();
      let leafCases: CaseInfo[] = [];
      caseResults.forEach(result => {
        leafCases = (result.values.cases as IAllCasesItem[]).map(({ case: { id, parent, values } }) => {
          const caseId = String(id);
          const parentValues = parent == null ? undefined : valuesById.get(String(parent));
          const merged = { ...parentValues, ...values };
          valuesById.set(caseId, merged);
          return { caseId, values: merged };
        });
      });
      // The last collection's cases are the leaves
      store.setCases(leafCases);
    } catch (error) {
      console.error("Unable to get the cases of", dataContextName, errorMessage(error));
    }
  };

  // Notices for a table arrive on its own channel. A listener can't be removed, so each table
  // gets one at most, and the handler checks the current selection when a notice arrives.
  const watchedDataContexts = new Set<string>();
  const watchDataContext = (name: string) => {
    if (watchedDataContexts.has(name)) return;
    watchedDataContexts.add(name);
    addDataContextChangeListener(name, notice => {
      const operation: string = notice.values?.operation ?? "";
      // A rename changes the table's title, which the Data Table list shows
      if (operation === "updateDataContext") {
        refreshDataContexts();
        return;
      }
      // Only the selected table matters here; selection-sync handles selectCases
      if (name !== store.dataContextName || operation === "selectCases") return;
      if (kCaseOperations.has(operation)) {
        refreshCases();
      } else {
        // Other changes, such as a renamed column or a new formula, can change the columns and the
        // values read from the cases
        refreshAttributes();
        refreshCases();
      }
    });
  };

  const refreshDataContexts = async () => {
    const request = ++dataContextsRequest;
    try {
      const result = await getListOfDataContexts();
      if (request !== dataContextsRequest || !result.success) return;
      const dataContexts: DataContextInfo[] = (result.values as INamedItem[]).map(dc => ({
        name: dc.name,
        title: dc.title || dc.name
      }));
      store.setDataContexts(dataContexts);
      dataContexts.forEach(dc => watchDataContext(dc.name));
      // Clear the selected table if it is gone. That also clears its column selections, and the
      // reaction below empties the column list.
      if (store.dataContextName && !dataContexts.some(dc => dc.name === store.dataContextName)) {
        store.setDataContext(undefined);
      }
    } catch (error) {
      console.error("Unable to get the list of tables:", errorMessage(error));
    }
  };

  // 3. Listen for tables being added or removed
  addDataContextsListListener(() => refreshDataContexts());

  // 4. Fetch the columns and cases whenever the selected table changes. The old table's columns are
  // cleared first, so they are never offered for the new table, while loading or if the fetch fails.
  // (setDataContext has already dropped the old table's cases.)
  reaction(() => store.dataContextName, () => {
    store.setAttributes([]);
    refreshAttributes();
    refreshCases();
  });

  // 5. Fetch the tables, then the columns and cases of the restored table
  await refreshDataContexts();
  await Promise.all([refreshAttributes(), refreshCases()]);
  return true;
};
