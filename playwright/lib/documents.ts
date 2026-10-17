import fs from "fs";
import path from "path";
import { expect, type Page } from "@playwright/test";
import { kPluginUrl, openDocument } from "./codap";
import { choose, expectPointsClearOfZoomButtons, optionsOf, pluginFrame } from "./plugin";

// Fixes the otherwise random layout, so no point a test clicks is under the zoom buttons, which would
// take the click
export const kFixtureSeed = 1;

// A fixture document with a plugin tile added
export const documentWithPlugin = (file: string) => {
  const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "fixtures", file), "utf8"));
  const pluginTileId = "WEBVtsnePlugin";
  const row = Object.values(fixture.content.rowMap)[0] as { tiles: Record<string, object> };
  row.tiles[pluginTileId] = { tileId: pluginTileId, x: 420, y: 5, width: 680, height: 334, zIndex: 2 };
  fixture.content.tileMap[pluginTileId] = {
    id: pluginTileId, name: "t-SNE Plot",
    content: { type: "CodapWebView", subType: "plugin", url: kPluginUrl, state: { version: 1, tsneSeed: kFixtureSeed } }
  };
  return fixture;
};

// The flat fixture with the plot done and colored by label
export const openFlatPlot = async (page: Page, document: object = documentWithPlugin("flat.codap")) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openDocument(page, document);
  const plugin = pluginFrame(page);
  await expect.poll(() => optionsOf(plugin, "Data Table")).toEqual(["Phrases"]);
  await choose(plugin, "Data Table", "Phrases");
  await expect.poll(() => optionsOf(plugin, "Phrase Column")).toEqual(["phrase", "label"]);
  await choose(plugin, "Phrase Column", "phrase");
  await choose(plugin, "Label Column", "label");
  await expect(plugin.locator(".graph-plot .point:not(.test-phrase-point)")).toHaveCount(40);
  await expectPointsClearOfZoomButtons(plugin);
  return plugin;
};
