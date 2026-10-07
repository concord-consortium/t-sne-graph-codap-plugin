import { reaction } from "mobx";
import { applySnapshot, getSnapshot } from "mobx-state-tree";
import {
  addDataContextChangeListener,
  addDataContextsListListener,
  codapInterface,
  getAttributeList,
  getCollectionList,
  getListOfDataContexts,
  IConfig
} from "@concord-consortium/codap-plugin-api";
import { AttributeInfo, DataContextInfo, IPluginStore } from "./plugin-store";

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

// Notices about cases and selection don't change the columns; selectCases arrives on every click
const kCaseOperations = new Set([
  "createCases", "updateCases", "deleteCases", "moveCases", "dependentCases", "selectCases"
]);

interface INamedItem {
  name: string;
  title?: string;
}

const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error);

/**
 * Connects to CODAP, restores the saved selections, and keeps the table and column lists current.
 * Resolves to false if CODAP never answered the handshake, in which case nothing else is started.
 */
export const startCodapSync = async (store: IPluginStore, config = kPluginConfig): Promise<boolean> => {
  let isRestored = false;

  // CODAP saves whatever value this returns. Answering with no value until restore finishes keeps
  // the document's saved state instead of overwriting it with the default store.
  codapInterface.on("get", "interactiveState", () => (
    isRestored ? { success: true, values: getSnapshot(store) } : { success: true }
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

  // Restore before any fetch, so the fetches validate the saved selections
  if (savedState && typeof savedState === "object") {
    try {
      applySnapshot(store, savedState);
    } catch (error) {
      console.error("Unable to restore saved state:", errorMessage(error));
    }
  }
  isRestored = true;

  // Each fetch takes a new request number; a response is applied only if no newer request was made
  let dataContextsRequest = 0;
  let attributesRequest = 0;

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
      } else if (name === store.dataContextName && !kCaseOperations.has(operation)) {
        refreshAttributes();
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
      // Clear the selected table if it is gone; the reaction below then clears the columns
      if (store.dataContextName && !dataContexts.some(dc => dc.name === store.dataContextName)) {
        store.setDataContext(undefined);
      }
    } catch (error) {
      console.error("Unable to get the list of tables:", errorMessage(error));
    }
  };

  // 2. Listen for tables being added or removed
  addDataContextsListListener(() => refreshDataContexts());

  // Fetch the columns whenever the selected table changes. The old table's columns are cleared first,
  // so they are never offered for the new table, while loading or if the fetch fails.
  reaction(() => store.dataContextName, () => {
    store.setAttributes([]);
    refreshAttributes();
  });

  // 3. and 4. Fetch the tables, then the columns of the restored table
  await refreshDataContexts();
  await refreshAttributes();
  return true;
};
