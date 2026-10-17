import React, { useState } from "react";
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

export const kInfoOpenedText = "Information opened in its own tile";
export const kInfoFailedText = "The information tile could not be opened";

interface IProps {
  store: IPluginStore;
}

export const App = ({ store }: IProps) => {
  // CODAP announces nothing when it selects an existing tile. A new key per press makes a new node,
  // which screen readers announce even when the text repeats.
  const [infoAnnouncement, setInfoAnnouncement] = useState({ text: "", key: 0 });
  const announceInfo = (text: string) => setInfoAnnouncement(({ key }) => ({ text, key: key + 1 }));

  const handleInfoPress = async () => {
    await whenCodapSettled(store);
    // The live state, not codapStatus: a CODAP that answers after init gave up reopens the connection
    if (codapInterface.getConnectionState() === "active") {
      announceInfo(await openInfoTile() === "opened" ? kInfoOpenedText : kInfoFailedText);
    } else {
      console.warn("CODAP is not connected; the information tile can't be opened");
      announceInfo(kInfoFailedText);
    }
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
            <p className="visually-hidden" role="status" data-testid="info-announcement">
              <span key={infoAnnouncement.key}>{infoAnnouncement.text}</span>
            </p>
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
