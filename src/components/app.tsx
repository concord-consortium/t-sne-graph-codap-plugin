import React from "react";
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

export const App = ({ store }: IProps) => (
  <StoreProvider store={store}>
    <div className="app">
      <div className="graph-area">
        <Graph />
      </div>
      <div className="controls-panel">
        <div className="controls-header">
          <DataSourceSelector />
          {/* Opens nothing yet: openInfoTile is wired in step 5 of the CODAP-1574 plan */}
          <InfoButton onPress={() => undefined} />
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
