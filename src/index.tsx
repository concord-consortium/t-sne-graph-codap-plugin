import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./components/app";
import { startCodapSync } from "./models/codap-sync";
import { startGraphController } from "./models/graph-controller";
import { PluginStore } from "./models/plugin-store";
import { startSelectionSync } from "./models/selection-sync";

import "./index.scss";

const store = PluginStore.create();

const container = document.getElementById("app");
if (container) {
  const root = createRoot(container);
  root.render(<App store={store} />);
}

// Started here rather than in a React effect, so they run exactly once
startCodapSync(store);
startGraphController(store);
startSelectionSync(store);
