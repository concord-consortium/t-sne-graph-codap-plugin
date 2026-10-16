import { codapInterface } from "@concord-consortium/codap-plugin-api";
import { kInfoTileName, kPluginVersion } from "./plugin-identity";

import "./info.scss";

// Connecting makes CODAP treat the tile as a plugin, which hides its URL button. No dimensions:
// CODAP applies them on every connect, which would undo a resize when the document reopens. The
// plugin sets the size once, when it creates the tile. Opened outside CODAP, init fails and the
// page still reads.
codapInterface.init({ name: kInfoTileName, version: kPluginVersion })
  .catch(error => console.warn("The information page could not connect to CODAP:", error));
