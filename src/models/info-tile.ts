import { codapInterface, IResult, sendMessage } from "@concord-consortium/codap-plugin-api";
import { kInfoTileName } from "../plugin-identity";
import { checkSuccess } from "./codap-sync";

// CODAP applies the dimensions to the whole tile, including its 34px title bar
export const kInfoTileSize = { width: 450, height: 300 };
// Between the plugin's tile and the new one
export const kInfoTileGap = 10;

// The build writes this tag into each plugin page (see webpack.config.js)
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

/**
 * The information page's URL. Not relative to this page: the released index.html is a copy of
 * index-top.html at the top level, while info.html is in the version folder.
 */
export const infoPageUrl = () => {
  const content = document.querySelector<HTMLMetaElement>(`meta[name="${kInfoPageMetaName}"]`)?.content;
  if (content) return new URL(content, document.baseURI).href;
  console.warn(`No ${kInfoPageMetaName} meta tag; looking for info.html beside this page`);
  return new URL("info.html", document.baseURI).href;
};

const isNumber = (value: unknown): value is number => typeof value === "number";

// Just right of the plugin's tile, or undefined to let CODAP choose. The frame gives the plugin's ID
// but not its position; the component gives both position and size.
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

// Brings the tile to the front if the document has one, otherwise creates it
const findOrCreateInfoTile = async (): Promise<InfoTileResult> => {
  try {
    const list = await sendMessage("get", "componentList");
    checkSuccess(list);
    const tile = (list.values as IComponentItem[]).find(
      ({ name, type }) => name === kInfoTileName && type !== undefined && kInfoTileTypes.has(type));
    if (tile) {
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

/**
 * Finds or creates the information tile. A call while one is in progress shares it, so quick clicks
 * can't both find no tile and both create one. Never opens a browser tab.
 */
export const openInfoTile = () => {
  inFlight ??= findOrCreateInfoTile().finally(() => { inFlight = undefined; });
  return inFlight;
};
