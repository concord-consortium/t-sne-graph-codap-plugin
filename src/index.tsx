import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./components/app";
import { startCodapSync } from "./models/codap-sync";
import { PluginStore } from "./models/plugin-store";

import "./index.scss";

const store = PluginStore.create();

const container = document.getElementById("app");
if (container) {
  const root = createRoot(container);
  root.render(<App store={store} />);
}

// Started here rather than in a React effect, so it runs exactly once
startCodapSync(store);
