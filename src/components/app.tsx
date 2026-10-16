import React from "react";
import { codapInterface } from "@concord-consortium/codap-plugin-api";
import { whenCodapSettled } from "../models/codap-sync";
import { openInfoTile } from "../models/info-tile";
import { IPluginStore } from "../models/plugin-store";
import { StoreProvider } from "../models/store-context";
import { DataSourceSelector } from "./data-source-selector";
import { Graph } from "./graph";
import { InfoButton } from "./info-button";
import { Key } from "./key";
import { TestPhrases } from "./test-phrases";
import "./app.scss";

interface IProps {
  store: IPluginStore;
}

export const App = ({ store }: IProps) => {
  const handleInfoPress = async () => {
    await whenCodapSettled(store);
    // The live state, not codapStatus: a CODAP that answers after init gave up reopens the connection
    if (codapInterface.getConnectionState() === "active") openInfoTile();
    else console.warn("CODAP is not connected; the information tile can't be opened");
  };

  return (
    <StoreProvider store={store}>
      <div className="app">
        <div className="graph-area">
          <Graph />
        </div>
        <div className="controls-panel">
          <div className="controls-header">
            <DataSourceSelector />
            <InfoButton onPress={handleInfoPress} />
          </div>
          <div className="lower-panel">
            <div className="lower-panel-left">
              <Key />
            </div>
            <div className="lower-panel-right">
              <TestPhrases />
            </div>
          </div>
        </div>
      </div>
    </StoreProvider>
  );
};
