import { expect, type FrameLocator, type Locator, type Page } from "@playwright/test";
import { tileTitled } from "./codap";

// Scoped by tile, since the information tile adds a second web-view frame
export const pluginFrame = (page: Page) => tileTitled(page, "t-SNE Plot").frameLocator(".codap-web-view-iframe");

// While a dropdown's list is open, React Aria hides the rest of the plugin from screen readers,
// so the buttons are found with includeHidden
export const dropdown = (plugin: FrameLocator, label: string) =>
  plugin.getByRole("button", { name: new RegExp(label), includeHidden: true });

// Opens a dropdown, reads its options, and closes it again
export const optionsOf = async (plugin: FrameLocator, label: string) => {
  await dropdown(plugin, label).click();
  const options = await plugin.getByRole("option").allTextContents();
  await plugin.locator("body").press("Escape");
  return options;
};

export const choose = async (plugin: FrameLocator, label: string, option: string) => {
  await dropdown(plugin, label).click();
  await plugin.getByRole("option", { name: option, exact: true }).click();
};

export const plot = (plugin: FrameLocator) => plugin.getByRole("group", { name: /^t-SNE plot/ });
// A point's name is its phrase, then ", label" when there is a Label Column
const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export const point = (plugin: FrameLocator, phrase: string) =>
  plugin.getByRole("button", { name: new RegExp(`^${escapeRegExp(phrase)}(, [^,]*)?$`) });
// A point's center in the plot, from its transform
export const centerOf = async (element: Locator) => {
  const [, x, y] = /translate\((-?[\d.e-]+) (-?[\d.e-]+)\)/.exec(await element.getAttribute("transform") ?? "") ?? [];
  return { x: Number(x), y: Number(y) };
};
// A dot in the flat fixture far from every other dot, so its tooltip and symbols are easy to see and hover
export const kIsolatedDot = "Every voice across the globe";
// Shift+Tab from the first dropdown reaches the plot by keyboard, which shows :focus-visible styles
export const tabToPlot = async (plugin: FrameLocator) => {
  await dropdown(plugin, "Data Table").focus();
  await dropdown(plugin, "Data Table").press("Shift+Tab");
  await expect(plot(plugin)).toBeFocused();
};
// Clicks a point's center. The plot, not the point element, takes the pointer and picks the nearest point, so
// Playwright's check that the element itself gets the click is skipped.
export const clickPoint = (element: Locator, options: { modifiers?: "Shift"[] } = {}) =>
  // eslint-disable-next-line playwright/no-force-option -- the point element takes no pointer events on purpose
  element.click({ ...options, force: true });
export const pressedPhrases = (plugin: FrameLocator) =>
  plugin.locator(".graph-plot .point[aria-pressed=true]").evaluateAll(points =>
    points.map(p => (p.getAttribute("aria-label") ?? "").replace(/, [^,]*$/, "")));

// Fails clearly, not as a timed-out click, if a layout change breaks kFixtureSeed
export const expectPointsClearOfZoomButtons = async (plugin: FrameLocator) => {
  const plotBox = await plugin.locator(".graph-plot").boundingBox();
  const zoomBox = await plugin.locator(".zoom-controls").boundingBox();
  if (!plotBox || !zoomBox) throw new Error("The plot or its zoom buttons are not visible");
  const right = zoomBox.x - plotBox.x + zoomBox.width + 30;
  const bottom = zoomBox.y - plotBox.y + zoomBox.height + 30;
  const underButtons = await plugin.locator(".graph-plot .point").evaluateAll((points, edges) =>
    points.filter(p => {
      const [, x, y] = /translate\((-?[\d.e-]+) (-?[\d.e-]+)\)/.exec(p.getAttribute("transform") ?? "") ?? [];
      return Number(x) < edges.right && Number(y) < edges.bottom;
    }).map(p => p.getAttribute("aria-label")), { right, bottom });
  expect(underButtons, "points near the zoom buttons; choose another kFixtureSeed").toEqual([]);
};

// More than 20px from every point, and clear of the zoom buttons
export const emptySpot = async (plugin: FrameLocator) => {
  const centers = await plugin.locator(".graph-plot .point").evaluateAll(points => points.map(p => {
    const [, x, y] = /translate\((-?[\d.e-]+) (-?[\d.e-]+)\)/.exec(p.getAttribute("transform") ?? "") ?? [];
    return { x: Number(x), y: Number(y) };
  }));
  const plotBox = await plugin.locator(".graph-plot").boundingBox();
  const zoomBox = await plugin.locator(".zoom-controls").boundingBox();
  if (!plotBox || !zoomBox) throw new Error("The plot or its zoom buttons are not visible");
  const kMargin = 12;
  const onZoomButtons = (x: number, y: number) =>
    x < zoomBox.x - plotBox.x + zoomBox.width + kMargin && y < zoomBox.y - plotBox.y + zoomBox.height + kMargin;
  for (let y = 20; y < 300; y += 20) {
    for (let x = 20; x < 300; x += 20) {
      if (!onZoomButtons(x, y) && centers.every(c => Math.hypot(c.x - x, c.y - y) > 20)) return { x, y };
    }
  }
  throw new Error("The plot has no empty space");
};

// Moves the mouse off the plugin, to hide a hover tooltip that could cover the next point a test clicks
export const moveMouseOff = (page: Page) => page.mouse.move(1, 1);

// The graph area's and the plot's sizes, and the plot's offsets from the area's edges, in whole pixels
export const plotLayout = async (plugin: FrameLocator) => {
  const area = await plugin.getByTestId("graph-area").boundingBox();
  const square = await plot(plugin).boundingBox();
  if (!area || !square) throw new Error("The plot is not visible");
  return {
    area: { width: Math.round(area.width), height: Math.round(area.height) },
    plot: { width: Math.round(square.width), height: Math.round(square.height) },
    left: Math.round(square.x - area.x), right: Math.round(area.x + area.width - square.x - square.width),
    top: Math.round(square.y - area.y), bottom: Math.round(area.y + area.height - square.y - square.height)
  };
};

// Each test phrase's nearest phrase in the flat fixture, by the plugin's TF-IDF
export const kTestPhrases = [
  { text: "kids who ride the bus", neighbor: "Kids who ride my bus" },
  { text: "nobody walks this road", neighbor: "Nobody walks this road alone" },
  { text: "people from every country", neighbor: "People in every country agree" },
  { text: "a few close friends", neighbor: "A few of my closest friends" },
  { text: "every person in the world", neighbor: "Each person in every nation" }
];
export const kSymbols = ["square", "triangle", "diamond", "plus", "star"];

export const testField = (plugin: FrameLocator, slot: number) =>
  plugin.getByRole("textbox", { name: `Test phrase ${slot + 1}` });
export const symbolPoint = (plugin: FrameLocator, slot: number) =>
  plugin.locator(`.test-phrase-point[data-symbol=${kSymbols[slot]}]`);

// Types a phrase and leaves the field with Tab, which commits it
export const enterTestPhrase = async (plugin: FrameLocator, slot: number, text: string) => {
  await testField(plugin, slot).fill(text);
  await testField(plugin, slot).press("Tab");
};

export const zoomButton = (plugin: FrameLocator, name: "Zoom in" | "Zoom out" | "Fit all") =>
  plugin.getByRole("button", { name, exact: true });
// Page coordinates of a spot in the plot
export const onPage = async (plugin: FrameLocator, { x, y }: { x: number, y: number }) => {
  const box = await plot(plugin).boundingBox();
  if (!box) throw new Error("The plot is not visible");
  return { x: box.x + x, y: box.y + y };
};
