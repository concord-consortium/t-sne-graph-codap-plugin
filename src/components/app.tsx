import React from "react";
import { IPluginStore } from "../models/plugin-store";
import { StoreProvider } from "../models/store-context";
import { DataSourceSelector } from "./data-source-selector";
import { Graph } from "./graph";
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
        </div>
      </div>
    </div>
  </StoreProvider>
);
