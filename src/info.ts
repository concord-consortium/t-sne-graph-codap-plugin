import { codapInterface } from "@concord-consortium/codap-plugin-api";
import { kInfoTileName, kPluginVersion } from "./plugin-identity";

import "./info.scss";

// Connecting makes CODAP treat the tile as a plugin, which hides its URL button. No dimensions:
// CODAP applies them on every connect, undoing a resize on reopen. The plugin sizes the tile when
// it creates it.
codapInterface.init({ name: kInfoTileName, version: kPluginVersion })
  .catch(error => console.warn("The information page could not connect to CODAP:", error));
