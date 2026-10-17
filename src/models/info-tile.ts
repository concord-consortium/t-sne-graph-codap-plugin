import { codapInterface, IResult, sendMessage } from "@concord-consortium/codap-plugin-api";
import { kInfoTileName } from "../plugin-identity";
import { checkSuccess } from "./codap-sync";

// Includes CODAP's title bar (see kTitleBarHeight in codap-sync.ts)
export const kInfoTileSize = { width: 450, height: 300 };
// Between the plugin's tile and the new one
export const kInfoTileGap = 10;

const kInfoPageMetaName = "t-sne-info-page";

// CODAP lists a web view as "game" once its page connects
const kInfoTileTypes = new Set(["webView", "game"]);

export type InfoTileResult = "opened" | "failed";

interface IComponentItem {
  id: number | string;
  name?: string;
  type?: string;
}

interface IPosition {
  left: number;
  top: number;
}

// From the meta tag the build writes, not relative to this page (see webpack.config.js)
export const infoPageUrl = () => {
  const content = document.querySelector<HTMLMetaElement>(`meta[name="${kInfoPageMetaName}"]`)?.content;
  if (content) return new URL(content, document.baseURI).href;
  console.warn(`No ${kInfoPageMetaName} meta tag; looking for info.html beside this page`);
  return new URL("info.html", document.baseURI).href;
};

const isNumber = (value: unknown): value is number => typeof value === "number";

// Undefined lets CODAP choose. The frame reply has the plugin's ID but no position, so the
// component is asked for it.
const positionBesidePlugin = async (): Promise<IPosition | undefined> => {
  try {
    const frame = await sendMessage("get", "interactiveFrame");
    checkSuccess(frame);
    const component = await sendMessage("get", `component[${frame.values.id}]`);
    checkSuccess(component);
    const { position, dimensions } = component.values ?? {};
    if (!isNumber(position?.left) || !isNumber(position?.top) || !isNumber(dimensions?.width)) return undefined;
    return { left: position.left + dimensions.width + kInfoTileGap, top: position.top };
  } catch (error) {
    console.warn("Unable to find the plugin's position; CODAP will place the information tile:", error);
    return undefined;
  }
};

const findInfoTile = async () => {
  const list = await sendMessage("get", "componentList");
  checkSuccess(list);
  return (list.values as IComponentItem[]).find(
    ({ name, type }) => name === kInfoTileName && type !== undefined && kInfoTileTypes.has(type));
};

// A saved tile keeps the address it was created with, and the address changes with each release (its
// version folder), so an old document would show an old page.
const updateTileUrl = async (tileId: number | string) => {
  try {
    const url = infoPageUrl();
    const component = await sendMessage("get", `component[${tileId}]`);
    checkSuccess(component);
    if (component.values?.URL === url) return;
    checkSuccess(await sendMessage("update", `component[${tileId}]`, { URL: url }));
  } catch (error) {
    console.warn("Unable to update the information tile's address:", error);
  }
};

/** Points the document's information tile, if it has one, at this build's page */
export const updateSavedInfoTile = async () => {
  try {
    const tile = await findInfoTile();
    if (tile) await updateTileUrl(tile.id);
  } catch (error) {
    console.warn("Unable to look for the information tile:", error);
  }
};

const findOrCreateInfoTile = async (): Promise<InfoTileResult> => {
  try {
    const tile = await findInfoTile();
    if (tile) {
      await updateTileUrl(tile.id);
      const selected = await codapInterface.sendRequest(
        { action: "notify", resource: `component[${tile.id}]`, values: { request: "select" } });
      checkSuccess(selected as IResult);
      return "opened";
    }
    const position = await positionBesidePlugin();
    const created = await sendMessage("create", "component", {
      type: "webView",
      name: kInfoTileName,
      title: kInfoTileName,
      URL: infoPageUrl(),
      dimensions: kInfoTileSize,
      ...(position && { position })
    });
    checkSuccess(created);
    return "opened";
  } catch (error) {
    console.warn("Unable to open the information tile:", error);
    return "failed";
  }
};

let inFlight: Promise<InfoTileResult> | undefined;

// A call made while one is in progress shares it, so quick clicks can't create two tiles
export const openInfoTile = () => {
  inFlight ??= findOrCreateInfoTile().finally(() => { inFlight = undefined; });
  return inFlight;
};
