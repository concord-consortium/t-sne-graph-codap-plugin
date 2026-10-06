import React, { useEffect, useId, useState } from "react";
import {
  createDataContext,
  createItems,
  createNewCollection,
  createTable,
  getAllItems,
  getDataContext,
  initializePlugin,
  addDataContextChangeListener,
  ClientNotification,
} from "@concord-consortium/codap-plugin-api";
import "./App.css";

const kPluginName = "t-SNE Graph";
const kVersion = "0.0.1";
const kInitialDimensions = {
  width: 380,
  height: 680
};
const kDataContextName = "SamplePluginData";

// CODAP Plugin API requests reject with an Error when CODAP doesn't answer,
// for example when the plugin is opened outside of CODAP.
const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error);

export const App = () => {
  const [codapResponse, setCodapResponse] = useState<any>(undefined);
  const [listenerNotification, setListenerNotification] = useState<string>();
  const [dataContext, setDataContext] = useState<any>(null);
  const responseId = useId();
  const notificationId = useId();

  useEffect(() => {
    initializePlugin({ pluginName: kPluginName, version: kVersion, dimensions: kInitialDimensions })
      .catch((error) => console.error("Unable to connect to CODAP:", errorMessage(error)));

    // this is an example of how to add a notification listener to a CODAP component
    // for more information on listeners and notifications, see
    // https://github.com/concord-consortium/codap/wiki/CODAP-Data-Interactive-Plugin-API#documentchangenotice
    const casesUpdatedListener = (listenerRes: ClientNotification) => {
      if (listenerRes.values.operation === "updateCases") {
        setListenerNotification(JSON.stringify(listenerRes.values.result));
      }
    };
    addDataContextChangeListener(kDataContextName, casesUpdatedListener);
  }, []);

  const handleOpenTable = async () => {
    try {
      const res = await createTable(kDataContextName);
      setCodapResponse(res);
    } catch (error) {
      setCodapResponse(`Error: ${errorMessage(error)}`);
    }
  };

  const createData = async () => {
    const existingDataContext = await getDataContext(kDataContextName);
    let createDC, createNC, createI;
    if (!existingDataContext.success) {
      createDC = await createDataContext(kDataContextName);
      setDataContext(createDC.values);
    }
    if (existingDataContext?.success || createDC?.success) {
      createNC = await createNewCollection(kDataContextName, "Pets", [
        { name: "animal", type: "categorical" },
        { name: "count", type: "numeric" }
      ]);
      createI = await createItems(kDataContextName, [
        { animal: "dog", count: 5 },
        { animal: "cat", count: 4 },
        { animal: "fish", count: 20 },
        { animal: "horse", count: 1 },
        { animal: "bird", count: 2 },
        { animal: "snake", count: 1 }
      ]);
    }

    setCodapResponse(`
      Data context created: ${JSON.stringify(createDC)}
      New collection created: ${JSON.stringify(createNC)}
      New items created: ${JSON.stringify(createI)}
    `);
  };

  const handleCreateData = async () => {
    try {
      await createData();
    } catch (error) {
      setCodapResponse(`Error: ${errorMessage(error)}`);
    }
  };

  const handleGetResponse = async () => {
    try {
      const result = await getAllItems(kDataContextName);
      setCodapResponse(result);
    } catch (error) {
      setCodapResponse(`Error: ${errorMessage(error)}`);
    }
  };

  return (
    <div className="App">
      t-SNE Graph
      <div className="buttons">
        <button onClick={handleCreateData}>
          Create some data
        </button>
        <button onClick={handleOpenTable} disabled={!dataContext}>
          Open Table
        </button>
        <button onClick={handleGetResponse}>
          See getAllItems response
        </button>
        <div className="response-area">
          <label htmlFor={responseId}>Response:</label>
          <output id={responseId} className="response">
            { codapResponse && `${JSON.stringify(codapResponse, null, "  ")}` }
          </output>
        </div>
      </div>
      <div className="response-area">
        <label htmlFor={notificationId}>Listener Notification:</label>
        <output id={notificationId} className="response">
          { listenerNotification && listenerNotification }
        </output>
      </div>
    </div>
  );
};
