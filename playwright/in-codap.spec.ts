import { execSync } from "child_process";
import path from "path";
import { AxeBuilder } from "@axe-core/playwright";
import { expect, type FrameLocator, type Locator, type Page } from "@playwright/test";
import { saveCodapDocument } from "./codap-document";
import { test } from "./fixtures";
import {
  kCodapUrl, kPluginUrl, openDocument, resizeTileBy, tableCell, tableSelectionCount, tileTitled
} from "./lib/codap";
import {
  choose, dropdown, emptySpot, enterTestPhrase, kSymbols, kTestPhrases, moveMouseOff, onPage, optionsOf, plot,
  plotLayout, pluginFrame, point, pressedPhrases, symbolPoint, tabToPlot, testField, zoomButton
} from "./lib/plugin";
import { documentWithPlugin, openFlatPlot } from "./lib/documents";
import { axeViolations } from "./lib/accessibility";

const kInfoTileTitle = "Information: t-SNE Plots";

const infoFrame = (page: Page) => tileTitled(page, kInfoTileTitle).frameLocator(".codap-web-view-iframe");

// Creates a new table in CODAP (one column, "Attribute Name")
const createTable = async (page: Page) => {
  await page.getByTestId("tool-shelf-button-table").click();
  await page.getByTestId("tool-shelf-table-new").click();
};

// Adds a column to the table and names it
const addColumn = async (page: Page, name: string) => {
  await page.locator(".codap-case-table [data-testid=collection-add-attribute-icon-button]").first().click();
  const nameInput = page.locator(".codap-case-table [data-testid=column-name-input]");
  await nameInput.fill(name);
  await nameInput.press("Enter");
};

test("lists a new table and its columns", async ({ page }) => {
  await page.goto(`${kCodapUrl}&di=${kPluginUrl}`);
  await expect(page.getByTestId("component-title-bar").first()).toContainText("t-SNE Plot");
  const plugin = pluginFrame(page);
  await expect(dropdown(plugin, "Phrase Column")).toHaveAttribute("aria-disabled", "true");

  // A table created in CODAP appears in the Data Table list
  await createTable(page);
  await expect.poll(() => optionsOf(plugin, "Data Table")).toEqual(["New Dataset"]);

  await choose(plugin, "Data Table", "New Dataset");
  await expect(dropdown(plugin, "Phrase Column")).not.toHaveAttribute("aria-disabled");
  await expect(dropdown(plugin, "Label Column")).not.toHaveAttribute("aria-disabled");
  // Enabled as soon as the table is selected; the columns arrive after a fetch
  await expect.poll(() => optionsOf(plugin, "Phrase Column")).toEqual(["Attribute Name"]);

  // A column added in CODAP appears in both column lists
  await addColumn(page, "phrase");
  await expect.poll(() => optionsOf(plugin, "Phrase Column")).toEqual(["Attribute Name", "phrase"]);
  expect(await optionsOf(plugin, "Label Column")).toEqual(["Attribute Name", "phrase"]);
});

test("restores the selections after the document is saved and reopened", async ({ page }) => {
  await page.goto(`${kCodapUrl}&di=${kPluginUrl}`);
  const plugin = pluginFrame(page);
  await createTable(page);
  await addColumn(page, "phrase");

  await choose(plugin, "Data Table", "New Dataset");
  await expect.poll(() => optionsOf(plugin, "Phrase Column")).toEqual(["Attribute Name", "phrase"]);
  await choose(plugin, "Phrase Column", "phrase");
  await choose(plugin, "Label Column", "Attribute Name");

  const saved = await saveCodapDocument(page);
  await openDocument(page, saved);

  // Once the column lists have loaded from CODAP, the restored selections are still there.
  // A dropdown with a value lists the "Select" item first.
  const reopened = pluginFrame(page);
  await expect.poll(() => optionsOf(reopened, "Phrase Column")).toEqual(["Select", "Attribute Name", "phrase"]);
  await expect(dropdown(reopened, "Data Table")).toHaveText("New Dataset");
  await expect(dropdown(reopened, "Phrase Column")).toHaveText("phrase");
  await expect(dropdown(reopened, "Label Column")).toHaveText("Attribute Name");
});

// Drags a column header onto the parent collection's header, as a user regroups a table
const moveColumnToParent = async (page: Page, column: string) => {
  const source = page.locator(`.codap-case-table [data-testid="codap-attribute-button ${column}"]`);
  const target = page.locator(".collection-table:nth-child(1) .codap-column-header:nth-child(2)");
  const from = await source.boundingBox();
  const to = await target.boundingBox();
  if (!from || !to) throw new Error("The column or its parent collection is not visible");
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 20 });
  await page.mouse.up();
};

test("lists leaf columns for Phrase, all columns for Label, and clears a Phrase that moves up", async ({ page }) => {
  await openDocument(page, documentWithPlugin("hierarchical.codap"));
  const plugin = pluginFrame(page);
  await expect.poll(() => optionsOf(plugin, "Data Table")).toEqual(["Phrases"]);
  await choose(plugin, "Data Table", "Phrases");

  await expect.poll(() => optionsOf(plugin, "Phrase Column")).toEqual(["phrase", "notes"]);
  expect(await optionsOf(plugin, "Label Column")).toEqual(["label", "phrase", "notes"]);
  await choose(plugin, "Phrase Column", "phrase");
  await choose(plugin, "Label Column", "label");

  // Moving "phrase" up to the parent collection means it no longer has one value per row
  await moveColumnToParent(page, "phrase");
  await expect(dropdown(plugin, "Phrase Column")).toHaveText("Select");
  await expect(dropdown(plugin, "Label Column")).toHaveText("label");
  expect(await optionsOf(plugin, "Phrase Column")).toEqual(["notes"]);
  expect(await optionsOf(plugin, "Label Column")).toEqual(["Select", "label", "phrase", "notes"]);
});

test("has no accessibility violations", async ({ page }) => {
  await page.goto(`${kCodapUrl}&di=${kPluginUrl}`);
  const plugin = pluginFrame(page);
  await expect(dropdown(plugin, "Data Table")).toBeVisible();

  // Closed dropdowns, two of them disabled
  expect(await axeViolations(page)).toEqual([]);

  // An open list, with a value selected so it includes the "Select" item
  await createTable(page);
  await choose(plugin, "Data Table", "New Dataset");
  await dropdown(plugin, "Data Table").click();
  await expect(plugin.getByRole("listbox")).toBeVisible();
  expect(await axeViolations(page)).toEqual([]);
});

// Forced-colors mode (e.g. Windows High Contrast) drops box-shadows, which the dropdowns use for
// their border and focus ring in normal mode
test("keeps borders and keyboard focus visible in forced-colors mode", async ({ page }) => {
  await page.emulateMedia({ forcedColors: "active" });
  await page.goto(`${kCodapUrl}&di=${kPluginUrl}`);
  const plugin = pluginFrame(page);
  await createTable(page);
  await choose(plugin, "Data Table", "New Dataset");

  const dataTable = dropdown(plugin, "Data Table");
  const style = (property: string) => dataTable.evaluate((el, p) => getComputedStyle(el).getPropertyValue(p), property);
  expect(await style("border-top-style")).toBe("solid");
  expect(await style("border-top-width")).toBe("1px");

  // Keyboard focus on the button (Tab to the next dropdown and back, so React Aria sees keyboard
  // use and shows the focus ring), then on an item in its list
  await dataTable.focus();
  await dataTable.press("Tab");
  await dropdown(plugin, "Phrase Column").press("Shift+Tab");
  await expect(dataTable).toHaveAttribute("data-focus-visible");
  expect(await style("outline-style")).toBe("solid");
  await dataTable.press("Enter");
  const focusedItem = plugin.locator(".dropdown-item[data-focus-visible]");
  await expect(focusedItem).toBeVisible();
  expect(await focusedItem.evaluate(el => getComputedStyle(el).outlineStyle)).toBe("solid");
});

// ---- Test phrases ----

const kNoWordsText = "No words in common with the table's phrases";
// The spec's minimum distance from a symbol to its neighbor's dot
const kMinNeighborOffset = 18;

const symbolButton = (plugin: FrameLocator, slot: number) =>
  plugin.getByRole("region", { name: "Test Phrases" }).getByRole("button").nth(slot);

const symbolOpacity = (plugin: FrameLocator, slot: number) =>
  symbolButton(plugin, slot).locator("svg").evaluate(svg => getComputedStyle(svg).opacity);
// Each placed slot's distance from its neighbor's dot, read in one step so both centers come from
// the same render
const distancesToNeighbors = (plugin: FrameLocator) =>
  plugin.locator(".graph-plot").evaluate((svg, testPhrases) => {
    const center = (element: Element | null) => {
      const [, x, y] = /translate\(([\d.-]+) ([\d.-]+)\)/.exec(element?.getAttribute("transform") ?? "") ?? [];
      return { x: Number(x), y: Number(y) };
    };
    // A case point's name ends with ", <label>"
    const byPhrase = (phrase: string) => Array.from(svg.querySelectorAll(".point:not(.test-phrase-point)"))
      .find(dot => (dot.getAttribute("aria-label") ?? "").replace(/, [^,]*$/, "") === phrase);
    return Array.from(svg.querySelectorAll(".test-phrase-point")).map(symbol => {
      const text = symbol.getAttribute("aria-label")?.replace(/^\w+ test phrase: /, "");
      const neighbor = testPhrases.find(phrase => phrase.text === text)?.neighbor ?? "";
      const a = center(symbol);
      const b = center(byPhrase(neighbor) ?? null);
      return Math.hypot(a.x - b.x, a.y - b.y);
    });
  }, kTestPhrases);

test("places a test phrase beside its nearest phrase, hides it while editing, and removes it when cleared",
  async ({ page }) => {
    const plugin = await openFlatPlot(page);
    await expect(symbolButton(plugin, 0)).toHaveAttribute("aria-disabled", "true");
    expect(await symbolOpacity(plugin, 0)).toBe("0.35");

    // Nothing is placed while typing; Tab commits, and the symbol appears beside its neighbor
    await testField(plugin, 0).fill(kTestPhrases[0].text);
    await expect(symbolPoint(plugin, 0)).toHaveCount(0);
    await testField(plugin, 0).press("Tab");
    await expect(symbolPoint(plugin, 0)).toHaveAttribute("aria-label", `Square test phrase: ${kTestPhrases[0].text}`);
    const [distance] = await distancesToNeighbors(plugin);
    expect(distance).toBeGreaterThanOrEqual(kMinNeighborOffset - 0.01);
    expect(distance).toBeLessThan(25);
    await expect(symbolButton(plugin, 0)).not.toHaveAttribute("aria-disabled");
    expect(await symbolOpacity(plugin, 0)).toBe("1");
    const placed = await symbolPoint(plugin, 0).getAttribute("transform");

    // Editing hides the point; Enter brings it back in the same place
    await testField(plugin, 0).click();
    await expect(symbolPoint(plugin, 0)).toHaveCount(0);
    expect(await symbolOpacity(plugin, 0)).toBe("1");
    await testField(plugin, 0).press("Enter");
    await expect(symbolPoint(plugin, 0)).toHaveAttribute("transform", placed ?? "");

    // Clearing the field removes the point and dims the symbol
    await enterTestPhrase(plugin, 0, "");
    await expect(symbolPoint(plugin, 0)).toHaveCount(0);
    await expect(testField(plugin, 0)).toHaveValue("");
    await expect(symbolButton(plugin, 0)).toHaveAttribute("aria-disabled", "true");
    expect(await symbolOpacity(plugin, 0)).toBe("0.35");
  });

test("restores the test phrases and their points after the document is saved and reopened", async ({ page }) => {
  const plugin = await openFlatPlot(page);
  for (const [slot, { text }] of kTestPhrases.entries()) await enterTestPhrase(plugin, slot, text);
  await expect(plugin.locator(".test-phrase-point")).toHaveCount(5);
  const transforms = (frame: FrameLocator) =>
    Promise.all(kSymbols.map((_symbol, slot) => symbolPoint(frame, slot).getAttribute("transform")));
  const placed = await transforms(plugin);

  // The phrases and their points come back in the same places, with no typing
  const saved = await saveCodapDocument(page);
  await openDocument(page, saved);
  const reopened = pluginFrame(page);
  await expect(reopened.locator(".test-phrase-point")).toHaveCount(5);
  for (const [slot, { text }] of kTestPhrases.entries()) await expect(testField(reopened, slot)).toHaveValue(text);
  expect(await transforms(reopened)).toEqual(placed);

  // A smaller tile moves the points, but each symbol stays at least 18px from its neighbor. The
  // plot is 300 × 300 at first; the panel keeps its 380px, and the tile loses 120 × 60.
  await resizeTileBy(page, -120, -60);
  await expect(plot(reopened)).toHaveAttribute("width", "180");
  await expect(plot(reopened)).toHaveAttribute("height", "180");
  const distances = await distancesToNeighbors(reopened);
  expect(distances).toHaveLength(5);
  distances.forEach(distance => expect(distance).toBeGreaterThanOrEqual(kMinNeighborOffset - 0.01));
});

test("selects test phrases with the symbol button and on the plot, together with CODAP's cases", async ({ page }) => {
  const plugin = await openFlatPlot(page);
  await enterTestPhrase(plugin, 0, kTestPhrases[0].text);
  await expect(symbolPoint(plugin, 0)).toBeVisible();
  const caseRow = "Everyone around the world shares this";

  // The symbol button selects the point alone; CODAP has no selection
  await symbolButton(plugin, 0).click();
  await expect(symbolPoint(plugin, 0)).toHaveAttribute("aria-pressed", "true");
  await expect(symbolButton(plugin, 0)).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => tableSelectionCount(page)).toBe(0);

  // A case point replaces it
  await point(plugin, caseRow).click();
  await expect.poll(() => pressedPhrases(plugin)).toEqual([caseRow]);
  await expect(symbolPoint(plugin, 0)).toHaveAttribute("aria-pressed", "false");

  // Shift-click adds the symbol to the case
  await symbolPoint(plugin, 0).click({ modifiers: ["Shift"] });
  await expect.poll(() => pressedPhrases(plugin)).toEqual([caseRow, `Square test phrase: ${kTestPhrases[0].text}`]);
  await expect.poll(() => tableSelectionCount(page)).toBe(1);

  // Shift-click removes a selected case point and keeps the test phrase, through CODAP's notice
  const otherRow = "Nobody anywhere feels this way";
  await point(plugin, otherRow).click({ modifiers: ["Shift"] });
  await expect.poll(() => pressedPhrases(plugin))
    .toEqual([caseRow, otherRow, `Square test phrase: ${kTestPhrases[0].text}`]);
  await moveMouseOff(page);
  await point(plugin, caseRow).click({ modifiers: ["Shift"] });
  await expect.poll(() => pressedPhrases(plugin)).toEqual([otherRow, `Square test phrase: ${kTestPhrases[0].text}`]);
  await expect.poll(() => tableSelectionCount(page)).toBe(1);

  // Empty space clears both
  await plot(plugin).click({ position: await emptySpot(plugin) });
  await expect.poll(() => pressedPhrases(plugin)).toEqual([]);
  await expect.poll(() => tableSelectionCount(page)).toBe(0);

  // A click on a table row unselects the symbol
  await symbolPoint(plugin, 0).click();
  await expect(symbolPoint(plugin, 0)).toHaveAttribute("aria-pressed", "true");
  await tableCell(page, caseRow).click();
  await expect.poll(() => pressedPhrases(plugin)).toEqual([caseRow]);

  // A Shift-click on a table row keeps it
  await symbolPoint(plugin, 0).click();
  await expect.poll(() => pressedPhrases(plugin)).toEqual([`Square test phrase: ${kTestPhrases[0].text}`]);
  await tableCell(page, caseRow).click({ modifiers: ["Shift"] });
  await expect.poll(() => pressedPhrases(plugin)).toEqual([caseRow, `Square test phrase: ${kTestPhrases[0].text}`]);
});

test("explains a phrase with no words in common, and gives it no point", async ({ page }) => {
  const plugin = await openFlatPlot(page);
  // Interim behavior until design decides
  await enterTestPhrase(plugin, 1, "zebra quilt");
  await expect(testField(plugin, 1)).toHaveAccessibleDescription(kNoWordsText);
  await expect(symbolButton(plugin, 1)).toHaveAccessibleDescription(kNoWordsText);
  await expect(testField(plugin, 1)).toHaveAttribute("title", kNoWordsText);
  // Placeholder styling: a violet border and a light violet fill, while the field isn't focused
  await expect(testField(plugin, 1)).toHaveCSS("background-color", "rgb(241, 235, 252)");
  await expect(testField(plugin, 1)).toHaveCSS("box-shadow", /rgb\(90, 31, 209\) 0px 0px 0px 2px inset/);
  // Focused, it keeps the fill under the blue focus border; typing starts a new phrase
  await testField(plugin, 1).focus();
  await expect(testField(plugin, 1)).toHaveCSS("background-color", "rgb(241, 235, 252)");
  await expect(testField(plugin, 1)).toHaveCSS("box-shadow", /rgb\(9, 87, 208\) 0px 0px 0px 2px inset/);
  await testField(plugin, 1).press("End");
  await testField(plugin, 1).press("s");
  await expect(testField(plugin, 1)).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await testField(plugin, 1).press("Escape");

  // Enter keeps focus, and still shows it
  await testField(plugin, 2).fill("neon octopus disco");
  await testField(plugin, 2).press("Enter");
  await expect(testField(plugin, 2)).toBeFocused();
  await expect(testField(plugin, 2)).toHaveCSS("background-color", "rgb(241, 235, 252)");
  await expect(symbolPoint(plugin, 1)).toHaveCount(0);
  await expect(symbolButton(plugin, 1)).toHaveAttribute("aria-disabled", "true");
  expect(await symbolOpacity(plugin, 1)).toBe("0.35");
});

test("never shows an edited phrase at its old place", async ({ page }) => {
  const plugin = await openFlatPlot(page);
  await enterTestPhrase(plugin, 0, kTestPhrases[0].text);
  await expect(symbolPoint(plugin, 0)).toBeVisible();
  const oldPlace = await symbolPoint(plugin, 0).getAttribute("transform");

  // Record the square's label and place on every change
  const pluginPage = page.frames().find(frame => frame.url().startsWith(kPluginUrl))!;
  await pluginPage.evaluate(() => {
    const record = globalThis as unknown as { squareLog: string[] };
    const state = () => {
      const square = document.querySelector(".test-phrase-point[data-symbol=square]");
      return square ? `${square.getAttribute("aria-label")}|${square.getAttribute("transform")}` : "none";
    };
    record.squareLog = [state()];
    new MutationObserver(() => {
      const current = state();
      if (current !== record.squareLog[record.squareLog.length - 1]) record.squareLog.push(current);
    }).observe(document.body, { attributes: true, childList: true, subtree: true });
  });

  // The old point goes before the new one comes, and the new phrase never shows at the old place
  const newText = kTestPhrases[1].text;
  await enterTestPhrase(plugin, 0, newText);
  await expect(symbolPoint(plugin, 0)).toHaveAttribute("aria-label", `Square test phrase: ${newText}`);
  const log = await pluginPage.evaluate(() => (globalThis as unknown as { squareLog: string[] }).squareLog);
  expect(log[0]).toBe(`Square test phrase: ${kTestPhrases[0].text}|${oldPlace}`);
  expect(log[1]).toBe("none");
  expect(log).not.toContain(`Square test phrase: ${newText}|${oldPlace}`);
  expect(log[log.length - 1]).not.toBe(`Square test phrase: ${newText}|${oldPlace}`);
});

test("has no accessibility violations with test phrases, one selected and one with no words", async ({ page }) => {
  const plugin = await openFlatPlot(page);
  // Placed, selected, empty, and no-words slots
  await enterTestPhrase(plugin, 0, kTestPhrases[0].text);
  await enterTestPhrase(plugin, 1, "zebra quilt");
  await symbolButton(plugin, 0).click();
  await expect(symbolPoint(plugin, 0)).toHaveAttribute("aria-pressed", "true");
  expect(await axeViolations(page)).toEqual([]);
});

test("keeps the test phrases' borders, symbols and focus visible in forced-colors mode", async ({ page }) => {
  await page.emulateMedia({ forcedColors: "active" });
  const plugin = await openFlatPlot(page);
  await enterTestPhrase(plugin, 0, kTestPhrases[0].text);
  await symbolButton(plugin, 0).click();
  await expect(symbolPoint(plugin, 0)).toHaveAttribute("aria-pressed", "true");

  const field = testField(plugin, 1);
  const fieldStyle = (property: string) =>
    field.evaluate((el, p) => getComputedStyle(el).getPropertyValue(p), property);
  expect(await fieldStyle("border-top-style")).toBe("solid");
  expect(await fieldStyle("border-top-width")).toBe("1px");
  await field.focus();
  expect(await fieldStyle("outline-style")).toBe("solid");

  // The symbols keep their color; the button's focus shows as an outline
  const fill = (locator: ReturnType<FrameLocator["locator"]>) => locator.evaluate(el => getComputedStyle(el).fill);
  expect(await fill(symbolButton(plugin, 0).locator(".symbol-fill"))).toBe("rgb(46, 0, 127)");
  expect(await fill(symbolPoint(plugin, 0).locator(".symbol"))).toBe("rgb(46, 0, 127)");
  expect(await symbolPoint(plugin, 0).locator(".selection-ring").evaluate(ring => getComputedStyle(ring).stroke))
    .toBe("rgb(0, 108, 142)");
  await field.press("Shift+Tab");
  await expect(symbolButton(plugin, 1)).toHaveAttribute("data-focus-visible");
  expect(await symbolButton(plugin, 1).evaluate(el => getComputedStyle(el).outlineStyle)).toBe("solid");
});

// ---- Zoom, fit all and panning ----

// Every case point's center, by phrase; off-plot centers can be negative
const pointCenters = (plugin: FrameLocator): Promise<Record<string, { x: number, y: number }>> =>
  plugin.locator(".graph-plot .point:not(.test-phrase-point)").evaluateAll(points =>
    Object.fromEntries(points.map(p => {
      const [, x, y] = /translate\((-?[\d.e-]+) (-?[\d.e-]+)\)/.exec(p.getAttribute("transform") ?? "") ?? [];
      return [p.getAttribute("aria-label"), { x: Number(x), y: Number(y) }];
    })));
// The point farthest from the 300 × 300 plot's center
const farthestFromCenter = (all: Record<string, { x: number, y: number }>) =>
  Object.entries(all).reduce((far, entry) =>
    Math.hypot(entry[1].x - 150, entry[1].y - 150) > Math.hypot(far[1].x - 150, far[1].y - 150) ? entry : far)[0];

test("zooms in about the center, fits all again, and stops at the largest zoom", async ({ page }) => {
  const plugin = await openFlatPlot(page);
  // Fit all has nothing to do at first
  await expect(zoomButton(plugin, "Fit all")).toHaveAttribute("aria-disabled", "true");
  await expect(zoomButton(plugin, "Zoom in")).not.toHaveAttribute("aria-disabled");
  await expect(zoomButton(plugin, "Zoom out")).not.toHaveAttribute("aria-disabled");
  const fit = await pointCenters(plugin);
  const far = farthestFromCenter(fit);

  // Zooming in moves a point near the edge 1.5 times as far from the center
  await zoomButton(plugin, "Zoom in").click();
  await expect(zoomButton(plugin, "Fit all")).not.toHaveAttribute("aria-disabled");
  // Wait for the redraw
  await expect.poll(() => pointCenters(plugin)).not.toEqual(fit);
  const zoomed = (await pointCenters(plugin))[far];
  expect(zoomed.x - 150).toBeCloseTo(1.5 * (fit[far].x - 150), 1);
  expect(zoomed.y - 150).toBeCloseTo(1.5 * (fit[far].y - 150), 1);
  await expect(plugin.getByTestId("zoom-announcement")).toHaveText("Zoom 150%");

  await zoomButton(plugin, "Fit all").click();
  await expect.poll(() => pointCenters(plugin)).toEqual(fit);
  await expect(zoomButton(plugin, "Fit all")).toHaveAttribute("aria-disabled", "true");
  await expect(plugin.getByTestId("zoom-announcement")).toHaveText("Zoom 100%, whole plot");

  for (let i = 0; i < 8; i++) await zoomButton(plugin, "Zoom in").click();
  await expect(zoomButton(plugin, "Zoom in")).toHaveAttribute("aria-disabled", "true");
  await zoomButton(plugin, "Zoom out").click();
  await expect(zoomButton(plugin, "Zoom in")).not.toHaveAttribute("aria-disabled");
});

test("pans with a mouse drag, which keeps CODAP's selection; a click still clears it", async ({ page }) => {
  const plugin = await openFlatPlot(page);
  const caseRow = "Everyone around the world shares this";
  await point(plugin, caseRow).click();
  await expect.poll(() => tableSelectionCount(page)).toBe(1);
  const before = await pointCenters(plugin);

  const start = await onPage(plugin, await emptySpot(plugin));
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 40, start.y, { steps: 10 });
  await page.mouse.up();
  // Wait for the redraw
  const [first] = Object.keys(before);
  await expect.poll(async () => (await pointCenters(plugin))[first].x - before[first].x).toBeCloseTo(40, 1);
  const after = await pointCenters(plugin);
  Object.keys(before).forEach(phrase => {
    expect(after[phrase].x - before[phrase].x).toBeCloseTo(40, 1);
    expect(after[phrase].y).toBeCloseTo(before[phrase].y, 1);
  });
  await expect(zoomButton(plugin, "Fit all")).not.toHaveAttribute("aria-disabled");
  expect(await tableSelectionCount(page)).toBe(1);

  await plot(plugin).click({ position: await emptySpot(plugin) });
  await expect.poll(() => tableSelectionCount(page)).toBe(0);
});

test.describe("with a touch screen", () => {
  test.use({ hasTouch: true });

  // Without `touch-action: none`, the browser takes the gesture and cancels the pointer, so the pan stops short
  test("pans the full distance with a finger drag, and keeps the first finger's drag past a second finger",
    async ({ page }) => {
      const plugin = await openFlatPlot(page);
      await point(plugin, "Everyone around the world shares this").click();
      await expect.poll(() => tableSelectionCount(page)).toBe(1);
      const before = await pointCenters(plugin);

      // Real touches, so the browser applies touch-action
      const cdp = await page.context().newCDPSession(page);
      const touch = (type: "touchStart" | "touchMove" | "touchEnd", touchPoints: { x: number, y: number }[]) =>
        cdp.send("Input.dispatchTouchEvent", { type, touchPoints });
      const start = await onPage(plugin, await emptySpot(plugin));
      await touch("touchStart", [start]);
      for (let dy = 5; dy <= 20; dy += 5) await touch("touchMove", [{ x: start.x, y: start.y + dy }]);
      // A second finger touches and lifts; the first keeps dragging
      const second = await onPage(plugin, { x: 280, y: 20 });
      await touch("touchMove", [{ x: start.x, y: start.y + 20 }, second]);
      await touch("touchMove", [{ x: start.x, y: start.y + 20 }]);
      for (let dy = 25; dy <= 40; dy += 5) await touch("touchMove", [{ x: start.x, y: start.y + dy }]);
      await touch("touchEnd", []);

      const [phrase] = Object.keys(before);
      await expect.poll(async () => (await pointCenters(plugin))[phrase].y - before[phrase].y).toBeCloseTo(40, 1);
      const after = await pointCenters(plugin);
      Object.keys(before).forEach(name => expect(after[name].y - before[name].y).toBeCloseTo(40, 1));
      // The second finger's tap changed no selection
      expect(await tableSelectionCount(page)).toBe(1);
    });
});

test("keeps the focused point inside the plot while arrowing through a zoomed-in plot", async ({ page }) => {
  const plugin = await openFlatPlot(page);
  for (let i = 0; i < 3; i++) await zoomButton(plugin, "Zoom in").click();
  await plot(plugin).focus();
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press("ArrowRight");
    const { x, y } = await plugin.locator(".graph-plot .point:focus").evaluate(p => {
      const [, px, py] = /translate\((-?[\d.e-]+) (-?[\d.e-]+)\)/.exec(p.getAttribute("transform") ?? "") ?? [];
      return { x: Number(px), y: Number(py) };
    });
    // Inside the padded area, 12px from each edge
    expect(x).toBeGreaterThanOrEqual(12 - 0.01);
    expect(x).toBeLessThanOrEqual(288 + 0.01);
    expect(y).toBeGreaterThanOrEqual(12 - 0.01);
    expect(y).toBeLessThanOrEqual(288 + 0.01);
  }
});

test("selects a dot clicked at the plot's edge without moving the view", async ({ page }) => {
  const plugin = await openFlatPlot(page);
  const fit = await pointCenters(plugin);
  await zoomButton(plugin, "Zoom in").click();
  await expect.poll(() => pointCenters(plugin)).not.toEqual(fit);
  // Drag the dot nearest the top-right corner to (298, 2), past the padded area on both sides, so a
  // focus pan would move it more than its 12px hit radius from the pointer. Not the bottom corner:
  // CODAP's tile border covers the plot's bottom edge.
  const zoomed = await pointCenters(plugin);
  const [name, center] = Object.entries(zoomed).reduce((near, entry) =>
    Math.hypot(300 - entry[1].x, entry[1].y) < Math.hypot(300 - near[1].x, near[1].y) ? entry : near);
  const start = await onPage(plugin, await emptySpot(plugin));
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 298 - center.x, start.y + 2 - center.y, { steps: 10 });
  await page.mouse.up();
  await expect.poll(async () => (await pointCenters(plugin))[name].x).toBeCloseTo(298, 0);
  const before = await pointCenters(plugin);
  expect(before[name].y).toBeCloseTo(2, 0);

  const target = await onPage(plugin, before[name]);
  await page.mouse.click(target.x, target.y);
  await expect.poll(() => tableSelectionCount(page)).toBe(1);
  expect(await pressedPhrases(plugin)).toEqual([name.replace(/, [^,]*$/, "")]);
  expect(await pointCenters(plugin)).toEqual(before);
});

test("restores the zoom and pan after the document is saved and reopened", async ({ page }) => {
  const plugin = await openFlatPlot(page);
  const fit = await pointCenters(plugin);
  await zoomButton(plugin, "Zoom in").click();
  await zoomButton(plugin, "Zoom in").click();
  await expect.poll(() => pointCenters(plugin)).not.toEqual(fit);
  const zoomed = await pointCenters(plugin);
  // From empty space, or the press clicks a point
  const start = await onPage(plugin, await emptySpot(plugin));
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x - 30, start.y + 20, { steps: 10 });
  await page.mouse.up();
  const [phrase] = Object.keys(zoomed);
  await expect.poll(async () => (await pointCenters(plugin))[phrase].x - zoomed[phrase].x).toBeCloseTo(-30, 1);
  const before = await pointCenters(plugin);
  expect(before[phrase].y - zoomed[phrase].y).toBeCloseTo(20, 1);

  const saved = await saveCodapDocument(page);
  await openDocument(page, saved);
  const reopened = pluginFrame(page);
  await expect(reopened.locator(".graph-plot .point")).toHaveCount(40);
  expect(await pointCenters(reopened)).toEqual(before);
  await expect(zoomButton(reopened, "Fit all")).not.toHaveAttribute("aria-disabled");
});

test("returns to the whole plot when the Phrase Column is cleared and chosen again", async ({ page }) => {
  const plugin = await openFlatPlot(page);
  const fit = await pointCenters(plugin);
  await zoomButton(plugin, "Zoom in").click();
  await expect.poll(() => pointCenters(plugin)).not.toEqual(fit);

  await choose(plugin, "Phrase Column", "Select, clear selection");
  await expect(plugin.locator(".graph-plot .point")).toHaveCount(0);
  await choose(plugin, "Phrase Column", "phrase");
  await expect(plugin.locator(".graph-plot .point")).toHaveCount(40);
  await expect.poll(() => pointCenters(plugin)).toEqual(fit);
  await expect(zoomButton(plugin, "Fit all")).toHaveAttribute("aria-disabled", "true");
});

test("has no accessibility violations with the zoom buttons enabled and disabled", async ({ page }) => {
  const plugin = await openFlatPlot(page);
  expect(await axeViolations(page)).toEqual([]);
  await zoomButton(plugin, "Zoom in").click();
  expect(await axeViolations(page)).toEqual([]);
  for (let i = 0; i < 7; i++) await zoomButton(plugin, "Zoom in").click();
  await expect(zoomButton(plugin, "Zoom in")).toHaveAttribute("aria-disabled", "true");
  expect(await axeViolations(page)).toEqual([]);
});

test("keeps the zoom buttons' frame, icons and focus visible in forced-colors mode", async ({ page }) => {
  await page.emulateMedia({ forcedColors: "active" });
  const plugin = await openFlatPlot(page);
  const style = (selector: string, property: string) => plugin.locator(selector).first().evaluate(
    (el, p) => getComputedStyle(el).getPropertyValue(p), property);
  expect(await style(".zoom-controls", "border-top-style")).toBe("solid");
  // Icons follow the text color
  const zoomIn = zoomButton(plugin, "Zoom in");
  expect(await zoomIn.locator("svg path").evaluate(icon => getComputedStyle(icon).fill))
    .toBe(await zoomIn.evaluate(el => getComputedStyle(el).color));

  // Tab away and back, so React Aria shows keyboard focus
  await zoomIn.focus();
  await zoomIn.press("Tab");
  await zoomButton(plugin, "Zoom out").press("Shift+Tab");
  await expect(zoomIn).toHaveAttribute("data-focus-visible");
  expect(await zoomIn.evaluate(el => getComputedStyle(el).outlineStyle)).toBe("solid");
  // Hovered too, the outline still differs from the fill
  await zoomIn.hover();
  await expect(zoomIn).toHaveAttribute("data-hovered");
  const { outline, fill } = await zoomIn.evaluate(el =>
    ({ outline: getComputedStyle(el).outlineColor, fill: getComputedStyle(el).backgroundColor }));
  expect(outline).not.toBe(fill);

  // A disabled icon is dimmed by GrayText alone
  await expect(zoomButton(plugin, "Fit all")).toHaveAttribute("aria-disabled", "true");
  expect(await zoomButton(plugin, "Fit all").locator(".zoom-icon").evaluate(el => getComputedStyle(el).opacity))
    .toBe("1");
});

// ---- Tooltips ----

// Dots in the flat fixture that no other dot's 24px target covers
const kIsolatedDot = "Every voice across the globe";
const kUnlabeledDot = "People I have never met";
// Under the isolated dot's tooltip
const kCoveredDot = "No one lives in isolation";
// Near the plot's right edge, and near its middle with a long phrase
const kRightEdgeDot = "None of us are by ourselves";
const kMiddleDot = "Everyone around the world shares this";

const tooltip = (plugin: FrameLocator) => plugin.getByTestId("point-tooltip");
// A point's center in the plot, from its transform
const centerOf = async (element: Locator) => {
  const [, x, y] = /translate\((-?[\d.e-]+) (-?[\d.e-]+)\)/.exec(await element.getAttribute("transform") ?? "") ?? [];
  return { x: Number(x), y: Number(y) };
};
// Moves the mouse onto a point's center, without Playwright's check that nothing covers it
const hoverPoint = async (page: Page, plugin: FrameLocator, element: Locator) => {
  const { x, y } = await onPage(plugin, await centerOf(element));
  await page.mouse.move(x, y);
};
const boxCenter = async (element: Locator) => {
  const box = await element.boundingBox();
  if (!box) throw new Error("The element is not visible");
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};
// The border's color is the first (inset) box-shadow's
const tooltipColors = (plugin: FrameLocator) => tooltip(plugin).evaluate(box => {
  const { backgroundColor, boxShadow } = getComputedStyle(box);
  const pointer = box.querySelector("[data-testid=pointer-border]");
  return { fill: backgroundColor, border: /^rgba?\([^)]*\)/.exec(boxShadow)?.[0],
    pointer: pointer && getComputedStyle(pointer).fill };
});
// Read in one step, so all come from the same render
const tooltipFit = (element: Locator) => element.evaluate((p: SVGGElement) => {
  const center = p.getScreenCTM();
  const border = document.querySelector<SVGPolygonElement>("[data-testid=pointer-border]");
  const box = document.querySelector<HTMLElement>("[data-testid=point-tooltip]");
  const area = document.querySelector("[data-testid=graph-area]")?.getBoundingClientRect();
  const ctm = border?.getScreenCTM();
  if (!center || !border || !box || !area || !ctm) throw new Error("No tooltip is showing");
  const tip = border.points[0];
  const rect = box.getBoundingClientRect();
  return {
    tipX: ctm.a * tip.x + ctm.c * tip.y + ctm.e - center.e,
    tipY: ctm.b * tip.x + ctm.d * tip.y + ctm.f - center.f,
    width: rect.width, height: rect.height, side: box.dataset.side,
    inside: rect.left >= area.left && rect.right <= area.right && rect.top >= area.top && rect.bottom <= area.bottom
  };
});
// The colored tip stops 1px short of a dot's center (`kTooltipTipGap`), on the box's side
const expectTipOnDot = ({ tipX, tipY, side }: { tipX: number, tipY: number, side?: string }) => {
  expect(tipX).toBeCloseTo(side === "left" ? -1 : 1, 1);
  expect(tipY).toBeCloseTo(0, 1);
};

test("shows a dot's phrase in its label's colors while the pointer is on it, aimed at its center",
  async ({ page }) => {
    const plugin = await openFlatPlot(page);
    await hoverPoint(page, plugin, point(plugin, kIsolatedDot));
    await expect(tooltip(plugin)).toHaveText(kIsolatedDot);
    // Similar's spec fill, and its dot color for the border and the pointer
    expect(await tooltipColors(plugin))
      .toEqual({ fill: "rgb(192, 207, 255)", border: "rgb(81, 105, 255)", pointer: "rgb(81, 105, 255)" });
    const fit = await tooltipFit(point(plugin, kIsolatedDot));
    expectTipOnDot(fit);
    expect(fit.side).toBe("right");
    expect(fit.inside).toBe(true);
    expect(Math.round(fit.height)).toBe(24);

    const empty = await onPage(plugin, await emptySpot(plugin));
    await page.mouse.move(empty.x, empty.y);
    await expect(tooltip(plugin)).toHaveCount(0);

    await hoverPoint(page, plugin, point(plugin, kUnlabeledDot));
    await expect(tooltip(plugin)).toHaveText(kUnlabeledDot);
    expect(await tooltipColors(plugin))
      .toEqual({ fill: "rgb(209, 209, 209)", border: "rgb(148, 148, 148)", pointer: "rgb(148, 148, 148)" });
  });

test("keeps the tooltip while the mouse is on it, and hides it on Escape until the mouse comes back",
  async ({ page }) => {
    const plugin = await openFlatPlot(page);
    // A click gives the plugin keyboard focus; the mouse stays on the dot
    await point(plugin, kIsolatedDot).click();
    await expect(tooltip(plugin)).toHaveText(kIsolatedDot);
    const box = await boxCenter(tooltip(plugin));
    await page.mouse.move(box.x, box.y, { steps: 5 });
    await expect(tooltip(plugin)).toHaveText(kIsolatedDot);
    await moveMouseOff(page);
    await expect(tooltip(plugin)).toHaveCount(0);

    await hoverPoint(page, plugin, point(plugin, kIsolatedDot));
    await expect(tooltip(plugin)).toHaveText(kIsolatedDot);
    await page.keyboard.press("Escape");
    await expect(tooltip(plugin)).toHaveCount(0);
    await moveMouseOff(page);
    await hoverPoint(page, plugin, point(plugin, kIsolatedDot));
    await expect(tooltip(plugin)).toHaveText(kIsolatedDot);
  });

// From a point's center, `dy` up or down, then one pointer event per pixel into its tooltip's near edge
const creepToTooltip = async (page: Page, plugin: FrameLocator, element: Locator, dy: number) => {
  const center = await onPage(plugin, await centerOf(element));
  const box = await tooltip(plugin).boundingBox();
  if (!box) throw new Error("The tooltip is not visible");
  const step = await tooltip(plugin).getAttribute("data-side") === "left" ? -1 : 1;
  const end = step > 0 ? box.x + 2 : box.x + box.width - 2;
  for (let x = center.x; (end - x) * step > 0; x += step) await page.mouse.move(x, center.y + dy);
  await page.mouse.move(end, center.y + dy);
};

test("keeps the tooltip while the mouse creeps from a dot or a symbol to it, level with the center or off it",
  async ({ page }) => {
    const plugin = await openFlatPlot(page);
    // The diamond reaches furthest from its center, so its box is furthest from its 12px target
    await enterTestPhrase(plugin, 2, kTestPhrases[2].text);
    for (const [element, text] of [
      [point(plugin, kIsolatedDot), kIsolatedDot], [symbolPoint(plugin, 2), kTestPhrases[2].text]
    ] as const) {
      for (const dy of [0, -8]) {
        await moveMouseOff(page);
        await hoverPoint(page, plugin, element);
        await expect(tooltip(plugin)).toHaveText(text);
        await creepToTooltip(page, plugin, element, dy);
        await expect(tooltip(plugin)).toHaveText(text);
      }
    }
  });

test("puts the tooltip on the left of a dot near the plot's right edge, inside the graph area", async ({ page }) => {
  const plugin = await openFlatPlot(page);
  await hoverPoint(page, plugin, point(plugin, kRightEdgeDot));
  await expect(tooltip(plugin)).toHaveText(kRightEdgeDot);
  const fit = await tooltipFit(point(plugin, kRightEdgeDot));
  expect(fit.side).toBe("left");
  expectTipOnDot(fit);
  expect(fit.inside).toBe(true);
});

test("narrows a long phrase's tooltip over a dot near the middle, so it fits beside the dot", async ({ page }) => {
  const plugin = await openFlatPlot(page);
  await hoverPoint(page, plugin, point(plugin, kMiddleDot));
  await expect(tooltip(plugin)).toHaveText(kMiddleDot);
  const fit = await tooltipFit(point(plugin, kMiddleDot));
  // Narrowed to fit beside the dot, so two lines
  expect(fit.width).toBeLessThan(150);
  expect(Math.round(fit.height)).toBe(40);
  expectTipOnDot(fit);
  expect(fit.inside).toBe(true);
});

test("shows a test phrase in the test-phrase colors, and cuts a long one short at 240px and two lines",
  async ({ page }) => {
    const plugin = await openFlatPlot(page);
    // Wide enough that a 240px box fits beside any point
    await resizeTileBy(page, 260, 0);
    await expect.poll(async () => (await plotLayout(plugin)).left).toBeGreaterThan(100);

    await enterTestPhrase(plugin, 0, kTestPhrases[0].text);
    await hoverPoint(page, plugin, symbolPoint(plugin, 0));
    await expect(tooltip(plugin)).toHaveText(kTestPhrases[0].text);
    expect(await tooltipColors(plugin))
      .toEqual({ fill: "rgb(203, 203, 255)", border: "rgb(46, 0, 127)", pointer: "rgb(46, 0, 127)" });
    // The square's half extent is 6.65px: 0.65px further out than a dot's
    const square = await tooltipFit(symbolPoint(plugin, 0));
    expect(Math.abs(square.tipX)).toBeCloseTo(1.65, 1);
    expect(square.tipY).toBeCloseTo(0, 1);

    const long = `${"people in every country ".repeat(11)}agree`.slice(0, 255);
    await enterTestPhrase(plugin, 1, long);
    await hoverPoint(page, plugin, symbolPoint(plugin, 1));
    await expect(tooltip(plugin)).toHaveText(long);
    const fit = await tooltipFit(symbolPoint(plugin, 1));
    expect(fit.width).toBeCloseTo(240, 0);
    expect(fit.height).toBeCloseTo(40, 0);
    // The ellipsis can't be read, so check that the text is cut
    expect(await plugin.getByTestId("point-tooltip-text").evaluate(text =>
      ({ isCut: text.scrollHeight > text.clientHeight, lines: getComputedStyle(text).webkitLineClamp })))
      .toEqual({ isCut: true, lines: "2" });
  });

test("shows the tooltip for the point the arrow keys reach, and moves it with them", async ({ page }) => {
  const plugin = await openFlatPlot(page);
  await tabToPlot(plugin);
  await expect(tooltip(plugin)).toHaveCount(0);
  const focusedPhrase = () => plugin.locator(".graph-plot .point:focus").evaluate(p =>
    (p.getAttribute("aria-label") ?? "").replace(/, [^,]*$/, ""));
  await page.keyboard.press("ArrowRight");
  const first = await focusedPhrase();
  await expect(tooltip(plugin)).toHaveText(first);
  await page.keyboard.press("ArrowRight");
  const second = await focusedPhrase();
  expect(second).not.toBe(first);
  await expect(tooltip(plugin)).toHaveText(second);
  expectTipOnDot(await tooltipFit(plugin.locator(".graph-plot .point:focus")));
});

// Jest checks that a drag hides the tooltip; here the dots move with the mouse, so it never reaches one
test("places the tooltip at a dot's new position after a zoom and a drag", async ({ page }) => {
  const plugin = await openFlatPlot(page);
  const fit = await centerOf(point(plugin, kMiddleDot));
  await zoomButton(plugin, "Zoom in").click();
  // Wait for the redraw
  await expect.poll(() => centerOf(point(plugin, kMiddleDot))).not.toEqual(fit);
  const before = await centerOf(point(plugin, kMiddleDot));

  const start = await onPage(plugin, await emptySpot(plugin));
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 40, start.y, { steps: 10 });
  await page.mouse.up();
  await expect.poll(async () => (await centerOf(point(plugin, kMiddleDot))).x - before.x).toBeCloseTo(40, 0);

  await hoverPoint(page, plugin, point(plugin, kMiddleDot));
  await expect(tooltip(plugin)).toHaveText(kMiddleDot);
  expectTipOnDot(await tooltipFit(point(plugin, kMiddleDot)));
});

test.describe("tooltips with a touch screen", () => {
  test.use({ hasTouch: true });

  test("shows a tapped dot's tooltip until a tap elsewhere", async ({ page }) => {
    const plugin = await openFlatPlot(page);
    const cdp = await page.context().newCDPSession(page);
    const tap = async (at: { x: number, y: number }) => {
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [at] });
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    };
    const tapPoint = async (phrase: string) => tap(await onPage(plugin, await centerOf(point(plugin, phrase))));

    await tapPoint(kIsolatedDot);
    await expect(point(plugin, kIsolatedDot)).toBeFocused();
    await expect(tooltip(plugin)).toHaveText(kIsolatedDot);
    await expect.poll(() => pressedPhrases(plugin)).toEqual([kIsolatedDot]);

    await tapPoint(kUnlabeledDot);
    await expect(point(plugin, kUnlabeledDot)).toBeFocused();
    await expect(tooltip(plugin)).toHaveText(kUnlabeledDot);
    await expect.poll(() => pressedPhrases(plugin)).toEqual([kUnlabeledDot]);

    await tap(await onPage(plugin, await emptySpot(plugin)));
    await expect(tooltip(plugin)).toHaveCount(0);
    await expect(plot(plugin)).toBeFocused();
    await expect.poll(() => pressedPhrases(plugin)).toEqual([]);

    // A dot under the tooltip's box takes the next tap
    await tapPoint(kIsolatedDot);
    await expect(tooltip(plugin)).toHaveText(kIsolatedDot);
    const covered = await onPage(plugin, await centerOf(point(plugin, kCoveredDot)));
    const box = await tooltip(plugin).boundingBox();
    expect(covered.x > (box?.x ?? 0) && covered.x < (box?.x ?? 0) + (box?.width ?? 0) &&
      covered.y > (box?.y ?? 0) && covered.y < (box?.y ?? 0) + (box?.height ?? 0)).toBe(true);
    await tap(covered);
    await expect(point(plugin, kCoveredDot)).toBeFocused();
    await expect(tooltip(plugin)).toHaveText(kCoveredDot);
    await expect.poll(() => pressedPhrases(plugin)).toEqual([kCoveredDot]);

    await tapPoint(kIsolatedDot);
    await expect(tooltip(plugin)).toHaveText(kIsolatedDot);
    await tap(await boxCenter(zoomButton(plugin, "Zoom in")));
    await expect(tooltip(plugin)).toHaveCount(0);
  });
});

test("keeps the tooltip inside a narrow graph area", async ({ page }) => {
  const plugin = await openFlatPlot(page);
  await resizeTileBy(page, -120, 0);
  await expect.poll(async () => (await plotLayout(plugin)).area.width).toBeLessThan(200);
  const { area } = await plotLayout(plugin);

  // Near the right edge: narrowed to fit on the left
  await hoverPoint(page, plugin, point(plugin, kRightEdgeDot));
  await expect(tooltip(plugin)).toHaveText(kRightEdgeDot);
  const edge = await tooltipFit(point(plugin, kRightEdgeDot));
  expect(edge.inside).toBe(true);
  expect(edge.width).toBeLessThan(area.width - 8);
  expectTipOnDot(edge);

  await moveMouseOff(page);
  // Near the middle, under 80px each side: clamped, so the tip falls short
  await hoverPoint(page, plugin, point(plugin, kMiddleDot));
  await expect(tooltip(plugin)).toHaveText(kMiddleDot);
  const middle = await tooltipFit(point(plugin, kMiddleDot));
  expect(middle.inside).toBe(true);
  expect(Math.abs(middle.tipX)).toBeGreaterThan(5);
  expect(middle.tipY).toBeCloseTo(0, 1);
});

test("has no accessibility violations with a tooltip showing", async ({ page }) => {
  const plugin = await openFlatPlot(page);
  await hoverPoint(page, plugin, point(plugin, kIsolatedDot));
  await expect(tooltip(plugin)).toHaveText(kIsolatedDot);
  expect(await axeViolations(page)).toEqual([]);
});

// ---- The information tile ----

const infoButton = (plugin: FrameLocator) => plugin.getByRole("button", { name: "Information about t-SNE plots" });

const boxOf = async (locator: Locator) => {
  const box = await locator.boundingBox();
  if (!box) throw new Error("The element is not visible");
  return box;
};

const dragBy = async (page: Page, x: number, y: number, dx: number, dy: number) => {
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 10 });
  await page.mouse.up();
};

const zIndexOf = (tile: Locator) => tile.evaluate(el => Number((el as HTMLElement).style.zIndex));

// CODAP shows the version label once the information page has connected
const openInfoTile = async (page: Page) => {
  await page.goto(`${kCodapUrl}&di=${kPluginUrl}`);
  await infoButton(pluginFrame(page)).click();
  const info = tileTitled(page, kInfoTileTitle);
  await expect(info.locator(".plugin-version")).toHaveText("0.0.1");
  return info;
};

test("puts the info button in the panel's top right, level with the Data Table row", async ({ page }) => {
  await page.goto(`${kCodapUrl}&di=${kPluginUrl}`);
  // Measured all at once, and polled, since CODAP may still be sizing the new tile
  const layout = () => pluginFrame(page).locator("body").evaluate(() => {
    const rect = (selector: string) => document.querySelector(selector)?.getBoundingClientRect() ?? new DOMRect();
    const button = rect(".info-button");
    const row = rect(".data-table-dropdown");
    const panel = rect(".controls-panel");
    return {
      size: [button.width, button.height],
      fromRowTop: button.top - row.top,
      rowHeight: row.height,
      // The panel has 12px of padding
      fromPanelRight: panel.right - button.right
    };
  });
  await expect.poll(layout).toEqual({ size: [24, 24], fromRowTop: 0, rowHeight: 24, fromPanelRight: 12 });
});

test("opens the information tile beside the plugin, showing the text and no URL button", async ({ page }) => {
  const info = await openInfoTile(page);
  await expect(info).toHaveCount(1);
  const plugin = await boxOf(tileTitled(page, "t-SNE Plot"));
  const tile = await boxOf(info);
  expect(tile).toEqual({ x: plugin.x + plugin.width + 10, y: plugin.y, width: 450, height: 300 });
  await expect(infoFrame(page).locator("h2").first()).toHaveText("What is a t-SNE plot?");
  await expect(infoFrame(page).locator("p").first()).toContainText("A t-SNE plot is a scatterplot");

  // CODAP shows the URL button only on a focused web view that is not a plugin
  await expect(info.locator(".codap-component")).toHaveClass(/focused/);
  await expect(info.getByTestId("web-view-edit-url-button")).toHaveCount(0);
});

test("scrolls the information text to its last section", async ({ page }) => {
  const info = await openInfoTile(page);
  const lastHeading = infoFrame(page).locator("h2").last();
  await expect(lastHeading).not.toBeInViewport();
  const frame = await boxOf(info.locator("iframe"));
  await page.mouse.move(frame.x + frame.width / 2, frame.y + frame.height / 2);
  await page.mouse.wheel(0, 2000);
  await expect(lastHeading).toBeInViewport();
});

test("moves the information tile by its title bar and reflows the text when it is resized", async ({ page }) => {
  const info = await openInfoTile(page);
  const before = await boxOf(info);
  // Left of the title, since clicking the title starts a rename
  const bar = await boxOf(info.locator(".component-title-bar"));
  await dragBy(page, bar.x + 60, bar.y + bar.height / 2, 100, 80);
  const moved = await boxOf(info);
  expect([moved.x, moved.y]).toEqual([before.x + 100, before.y + 80]);

  const paragraph = infoFrame(page).locator("p").first();
  const narrowHeight = (await boxOf(paragraph)).height;
  const corner = await boxOf(info.locator(".codap-component-corner.bottom-right"));
  await dragBy(page, corner.x + corner.width / 2, corner.y + corner.height / 2, 200, 100);
  expect((await boxOf(info)).width).toBe(moved.width + 200);
  await expect.poll(async () => (await boxOf(paragraph)).height).toBeLessThan(narrowHeight);
});

test("brings the existing information tile to the front instead of opening another", async ({ page }) => {
  const info = await openInfoTile(page);
  const pluginTile = tileTitled(page, "t-SNE Plot");
  // Put the plugin in front first
  const bar = await boxOf(pluginTile.locator(".component-title-bar"));
  await page.mouse.click(bar.x + 60, bar.y + bar.height / 2);
  await expect.poll(async () => await zIndexOf(pluginTile) > await zIndexOf(info)).toBe(true);

  await infoButton(pluginFrame(page)).click();
  await expect.poll(async () => await zIndexOf(info) > await zIndexOf(pluginTile)).toBe(true);
  await expect(info.locator(".codap-component")).toHaveClass(/focused/);
  await expect(info).toHaveCount(1);
});

test("opens a new information tile after the last one was closed", async ({ page }) => {
  const info = await openInfoTile(page);
  // The title bar covers its buttons until the pointer is over it
  await info.locator(".component-title-bar").hover({ position: { x: 60, y: 10 } });
  await info.getByTestId("component-close-button").click();
  await expect(info).toHaveCount(0);
  await infoButton(pluginFrame(page)).click();
  await expect(info).toHaveCount(1);
  await expect(infoFrame(page).locator("h2").first()).toHaveText("What is a t-SNE plot?");
});

test("keeps the information tile, at the size it was given, after the document is saved and reopened",
  async ({ page }) => {
    const info = await openInfoTile(page);
    const corner = await boxOf(info.locator(".codap-component-corner.bottom-right"));
    await dragBy(page, corner.x + corner.width / 2, corner.y + corner.height / 2, 150, 50);
    const resized = await boxOf(info);
    // Otherwise the size check after reopening proves nothing
    expect([resized.width, resized.height]).toEqual([450 + 150, 300 + 50]);

    const saved = await saveCodapDocument(page);
    await openDocument(page, saved);
    // By now the page's init has run; it must not reset the size
    await expect(info.locator(".plugin-version")).toHaveText("0.0.1");
    await expect(infoFrame(page).locator("h2").first()).toHaveText("What is a t-SNE plot?");
    const reopened = await boxOf(info);
    expect([reopened.width, reopened.height]).toEqual([resized.width, resized.height]);

    await infoButton(pluginFrame(page)).click();
    await expect(info.locator(".codap-component")).toHaveClass(/focused/);
    await expect(info).toHaveCount(1);
  });

test("opens one information tile for two quick clicks", async ({ page }) => {
  await page.goto(`${kCodapUrl}&di=${kPluginUrl}`);
  // Two clicks in one task. React Aria treats a click() with no pointer details as a press.
  await infoButton(pluginFrame(page)).evaluate(el => {
    (el as HTMLElement).click();
    (el as HTMLElement).click();
  });
  const info = tileTitled(page, kInfoTileTitle);
  // A second tile, if any, would exist before this one's page connects
  await expect(info.locator(".plugin-version")).toHaveText("0.0.1");
  await expect(info).toHaveCount(1);
});

// A release puts a copy of index-top.html at the top level, while info.html stays in the version
// folder (see webpack.config.js). build:top-test makes that layout in top-test/, served here at a
// made-up address. Built in this one test so parallel workers don't collide.
const kReleaseUrl = "https://release.test/";
const kReleaseDeployPath = "specific/release/";

test("opens the information page from a release, where info.html is only in the version folder", async ({ page }) => {
  test.setTimeout(240_000);
  const root = path.join(__dirname, "..");
  execSync("npm run build:top-test", { cwd: root, stdio: "pipe" });
  await page.route(`${kReleaseUrl}**`, route => {
    const { pathname } = new URL(route.request().url());
    const file = pathname === "/index.html" ? "index-top.html"
      : pathname.startsWith(`/${kReleaseDeployPath}`) ? pathname.slice(1) : undefined;
    return file ? route.fulfill({ path: path.join(root, "top-test", file) }) : route.fulfill({ status: 404 });
  });

  await page.goto(`${kCodapUrl}&di=${kReleaseUrl}index.html`);
  await infoButton(pluginFrame(page)).click();
  const info = tileTitled(page, kInfoTileTitle);
  await expect(infoFrame(page).locator("h2").first()).toHaveText("What is a t-SNE plot?");
  // CODAP adds its language to the address
  const releasedPage = /^https:\/\/release\.test\/specific\/release\/info\.html\?/;
  await expect(info.locator("iframe")).toHaveAttribute("src", releasedPage);
});

test("has no accessibility violations on the information page", async ({ page }) => {
  await page.goto(`${kPluginUrl}/info.html`);
  const { violations } = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(violations.map(({ id, nodes }) => ({ id, elements: nodes.map(node => node.target.join(" ")) })))
    .toEqual([]);
});

test("keeps the info button's hover and keyboard focus visible in forced-colors mode", async ({ page }, testInfo) => {
  await page.emulateMedia({ forcedColors: "active" });
  await page.goto(`${kCodapUrl}&di=${kPluginUrl}`);
  const plugin = pluginFrame(page);
  const button = infoButton(plugin);
  const style = (property: string) => button.evaluate((el, p) => getComputedStyle(el).getPropertyValue(p), property);

  // Tab from the last dropdown, so React Aria shows keyboard focus
  await dropdown(plugin, "Label Column").focus();
  await dropdown(plugin, "Label Column").press("Tab");
  await expect(button).toHaveAttribute("data-focus-visible");
  expect([await style("outline-style"), await style("outline-width"), await style("outline-offset")])
    .toEqual(["solid", "2px", "0px"]);
  await testInfo.attach("info button with keyboard focus, forced colors", {
    body: await plugin.locator(".controls-header").screenshot(), contentType: "image/png"
  });

  await button.hover();
  await expect(button).toHaveAttribute("data-hovered");
  expect(await style("background-color")).not.toBe("rgba(0, 0, 0, 0)");
  await testInfo.attach("info button hovered and focused, forced colors", {
    body: await plugin.locator(".controls-header").screenshot(), contentType: "image/png"
  });
});
