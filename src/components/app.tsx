import React, { useEffect } from "react";
import { initializePlugin } from "@concord-consortium/codap-plugin-api";
import "./app.css";

const kPluginName = "t-SNE Plot";
const kVersion = "0.0.1";
// Tile content size; CODAP adds the header bar and outline
const kInitialDimensions = {
  width: 680,
  height: 300
};

// CODAP Plugin API requests reject with an Error when CODAP doesn't answer,
// for example when the plugin is opened outside of CODAP.
const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error);

export const App = () => {
  useEffect(() => {
    initializePlugin({ pluginName: kPluginName, version: kVersion, dimensions: kInitialDimensions })
      .catch((error) => console.error("Unable to connect to CODAP:", errorMessage(error)));
  }, []);

  return (
    <div className="App" />
  );
};
