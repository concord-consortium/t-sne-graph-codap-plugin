import fs from "fs";
import path from "path";
import { expect, type FrameLocator, type Locator, type Page, type TestInfo } from "@playwright/test";
import { saveCodapDocument } from "./codap-document";
import { test } from "./fixtures";
import { kPluginUrl, openDocument, resizeTileBy, tableCell, tableSelectionCount } from "./lib/codap";
import {
  clickPoint, emptySpot, enterTestPhrase, kSymbols, kTestPhrases, moveMouseOff, onPage, plot, pluginFrame, point,
  pressedPhrases, symbolPoint, testField
} from "./lib/plugin";
import { openFlatPlot } from "./lib/documents";
import { axeViolations } from "./lib/accessibility";

const kNoWordsText = "No words in common with the table's phrases";
// The spec's minimum distance from a symbol to its neighbor's dot
const kMinNeighborOffset = 18;

const symbolButton = (plugin: FrameLocator, slot: number) =>
  plugin.getByRole("region", { name: "Test Phrases" }).getByRole("button").nth(slot);

const symbolOpacity = (plugin: FrameLocator, slot: number) =>
  symbolButton(plugin, slot).locator(".symbol-body").evaluate(body => getComputedStyle(body).opacity);
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

  // A larger tile moves the points, but each symbol stays at least 18px from its neighbor. The
  // plot is 300 × 300 at first, which is also its smallest; the panel keeps its 380px, and the tile
  // gains 120 × 60.
  await resizeTileBy(page, 120, 60);
  await expect(plot(reopened)).toHaveAttribute("width", "360");
  await expect(plot(reopened)).toHaveAttribute("height", "360");
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
  await clickPoint(point(plugin, caseRow));
  await expect.poll(() => pressedPhrases(plugin)).toEqual([caseRow]);
  await expect(symbolPoint(plugin, 0)).toHaveAttribute("aria-pressed", "false");

  // Shift-click adds the symbol to the case
  await clickPoint(symbolPoint(plugin, 0), { modifiers: ["Shift"] });
  await expect.poll(() => pressedPhrases(plugin)).toEqual([caseRow, `Square test phrase: ${kTestPhrases[0].text}`]);
  await expect.poll(() => tableSelectionCount(page)).toBe(1);

  // Shift-click removes a selected case point and keeps the test phrase, through CODAP's notice
  const otherRow = "Nobody anywhere feels this way";
  await clickPoint(point(plugin, otherRow), { modifiers: ["Shift"] });
  await expect.poll(() => pressedPhrases(plugin))
    .toEqual([caseRow, otherRow, `Square test phrase: ${kTestPhrases[0].text}`]);
  await moveMouseOff(page);
  await clickPoint(point(plugin, caseRow), { modifiers: ["Shift"] });
  await expect.poll(() => pressedPhrases(plugin)).toEqual([otherRow, `Square test phrase: ${kTestPhrases[0].text}`]);
  await expect.poll(() => tableSelectionCount(page)).toBe(1);

  // Empty space clears both
  await plot(plugin).click({ position: await emptySpot(plugin) });
  await expect.poll(() => pressedPhrases(plugin)).toEqual([]);
  await expect.poll(() => tableSelectionCount(page)).toBe(0);

  // A click on a table row unselects the symbol
  await clickPoint(symbolPoint(plugin, 0));
  await expect(symbolPoint(plugin, 0)).toHaveAttribute("aria-pressed", "true");
  await tableCell(page, caseRow).click();
  await expect.poll(() => pressedPhrases(plugin)).toEqual([caseRow]);

  // A Shift-click on a table row keeps it
  await clickPoint(symbolPoint(plugin, 0));
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

  // The symbols keep their color; the button's focus ring shows in Highlight
  const fill = (locator: ReturnType<FrameLocator["locator"]>) => locator.evaluate(el => getComputedStyle(el).fill);
  expect(await fill(symbolButton(plugin, 0).locator(".symbol-fill"))).toBe("rgb(46, 0, 127)");
  expect(await fill(symbolPoint(plugin, 0).locator(".symbol"))).toBe("rgb(46, 0, 127)");
  expect(await symbolPoint(plugin, 0).locator(".selection-ring").evaluate(ring => getComputedStyle(ring).stroke))
    .toBe("rgb(0, 108, 142)");
  await field.press("Shift+Tab");
  await expect(symbolButton(plugin, 1)).toHaveAttribute("data-focus-visible");
  const focusRing = await symbolButton(plugin, 1).locator(".focus-ring").evaluate(ring => {
    const highlight = document.createElement("span");
    highlight.style.color = "Highlight";
    document.body.append(highlight);
    const { stroke, visibility } = getComputedStyle(ring);
    const expected = getComputedStyle(highlight).color;
    highlight.remove();
    return { stroke, visibility, expected };
  });
  expect(focusRing.visibility).toBe("visible");
  expect(focusRing.stroke).toBe(focusRing.expected);
});

// A dot in the flat fixture far from every other dot, so its symbols are easy to see and hover
const kIsolatedDot = "Every voice across the globe";
const transformOf = (element: Locator) => element.getAttribute("transform");
// A point's center in the plot, from its transform
const centerOf = async (element: Locator) => {
  const [, x, y] = /translate\((-?[\d.e-]+) (-?[\d.e-]+)\)/.exec(await transformOf(element) ?? "") ?? [];
  return { x: Number(x), y: Number(y) };
};
// Each point's name, in drawing order
const drawOrder = (plugin: FrameLocator) =>
  plugin.locator(".graph-plot .point").evaluateAll(points => points.map(p => p.getAttribute("aria-label")));

test("puts a test phrase that matches a dataset phrase under its dot, and reaches it at its visible part",
  async ({ page }) => {
    const plugin = await openFlatPlot(page);
    // Matched after trimming, collapsing spaces and lowercasing
    await enterTestPhrase(plugin, 0, kIsolatedDot);
    await enterTestPhrase(plugin, 1, ` ${kIsolatedDot.toLowerCase()} `);
    await enterTestPhrase(plugin, 4, kIsolatedDot);
    await expect(plugin.locator(".test-phrase-point")).toHaveCount(3);

    // One spot, the dot's, with the symbols drawn before it: the highest slot first
    const dot = await transformOf(point(plugin, kIsolatedDot));
    for (const slot of [0, 1, 4]) await expect(symbolPoint(plugin, slot)).toHaveAttribute("transform", dot ?? "");
    const order = await drawOrder(plugin);
    const dotIndex = order.findIndex(name => name?.startsWith(`${kIsolatedDot}, `));
    const squareIndex = order.indexOf(`Square test phrase: ${kIsolatedDot}`);
    expect(order.indexOf(`Star test phrase: ${kIsolatedDot}`)).toBeLessThan(squareIndex);
    expect(squareIndex).toBeLessThan(dotIndex);

    // The second slot's selection ring is drawn, around the dot
    await symbolButton(plugin, 1).click();
    await expect(symbolPoint(plugin, 1)).toHaveAttribute("aria-pressed", "true");
    await expect(symbolPoint(plugin, 1).locator(".selection-ring")).toHaveCount(1);

    // On the dot: the dot's tooltip, in its label's colors
    const center = await centerOf(point(plugin, kIsolatedDot));
    const move = async (dx: number, dy: number) => {
      const { x, y } = await onPage(plugin, { x: center.x + dx, y: center.y + dy });
      await page.mouse.move(x, y);
    };
    const tooltip = plugin.getByTestId("point-tooltip");
    const tooltipFill = () => tooltip.evaluate(box => getComputedStyle(box).backgroundColor);
    await move(0, 0);
    await expect(tooltip).toHaveText(kIsolatedDot);
    expect(await tooltipFill()).toBe("rgb(192, 207, 255)");
    // Toward the star's right tip, outside the dot: a test phrase's purple tooltip. The hit test treats a symbol as
    // a square, so the triangle above the star may take this spot; both have the phrase, as typed.
    await move(8, -2.6);
    await expect.poll(tooltipFill).toBe("rgb(203, 203, 255)");
    await expect(tooltip).toHaveText(new RegExp(`^${kIsolatedDot}$`, "i"));
  });

// Attached to the report; also saved to doc/design when SAVE_DESIGN_SCREENSHOTS is set
const saveScreenshot = async (
  page: Page, testInfo: TestInfo, clip: { x: number, y: number, width: number, height: number }, name: string
) => {
  const image = await page.screenshot({ clip });
  await testInfo.attach(name, { body: image, contentType: "image/png" });
  if (process.env.SAVE_DESIGN_SCREENSHOTS) fs.writeFileSync(path.join(__dirname, "..", "doc", "design", name), image);
};

test.describe("at 2×", () => {
  test.use({ deviceScaleFactor: 2 });

  // For the team to decide whether the hidden square is acceptable (CODAP-1575 fixes plan §3.3 step 7)
  test("shows a square under a dot, unselected and selected", async ({ page }, testInfo) => {
    const plugin = await openFlatPlot(page);
    await enterTestPhrase(plugin, 0, kIsolatedDot);
    const dot = await transformOf(point(plugin, kIsolatedDot));
    await expect(symbolPoint(plugin, 0)).toHaveAttribute("transform", dot ?? "");
    await moveMouseOff(page);
    const { x, y } = await onPage(plugin, await centerOf(point(plugin, kIsolatedDot)));
    const clip = { x: x - 30, y: y - 30, width: 60, height: 60 };
    const save = (name: string) => saveScreenshot(page, testInfo, clip, name);

    await save("square-under-dot.png");
    await symbolButton(plugin, 0).click();
    await expect(symbolPoint(plugin, 0)).toHaveAttribute("aria-pressed", "true");
    await save("square-under-dot-selected.png");
  });
});
