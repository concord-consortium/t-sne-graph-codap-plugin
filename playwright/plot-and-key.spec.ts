import { expect, type FrameLocator, type Page } from "@playwright/test";
import { saveCodapDocument } from "./codap-document";
import { test } from "./fixtures";
import { kHierarchicalPhrases as kFixturePhrases } from "./fixtures/hierarchical-phrases";
import { kPluginUrl, openDocument, resizeTileBy, tableCell } from "./lib/codap";
import {
  choose, dropdown, emptySpot, expectPointsClearOfZoomButtons, optionsOf, plot, plotLayout, pluginFrame, point,
  pressedPhrases, tabToPlot
} from "./lib/plugin";
import { documentWithPlugin } from "./lib/documents";
import { axeViolations } from "./lib/accessibility";

const kAllPhrases = Object.values(kFixturePhrases).flat();

const keyEntries = (plugin: FrameLocator) =>
  plugin.getByRole("region", { name: "Key" }).getByRole("button").evaluateAll(buttons =>
    buttons.map(button => button.getAttribute("aria-label")));
// Each point's position, by phrase (its name without the label)
const positions = (plugin: FrameLocator) => plugin.locator(".graph-plot .point").evaluateAll(points =>
  Object.fromEntries(points.map(p =>
    [(p.getAttribute("aria-label") ?? "").replace(/, [^,]*$/, ""), p.getAttribute("transform")])));

const plotOutline = (plugin: FrameLocator) => plot(plugin).evaluate(svg => {
  const { outlineStyle, outlineWidth, outlineColor } = getComputedStyle(svg);
  return { outlineStyle, outlineWidth, outlineColor };
});
const dotFill = (plugin: FrameLocator, phrase: string) =>
  point(plugin, phrase).locator(".dot").evaluate(dot => getComputedStyle(dot).fill);

// A row's text is its index, then its values: a parent row is just its label; a leaf row starts
// with its phrase.
const selectedInTable = async (page: Page) => {
  const rows = (await page.locator(".codap-case-table [role=row][aria-selected=true]").allTextContents())
    .map(row => row.replace(/^\d+/, ""));
  return [
    ...Object.keys(kFixturePhrases).filter(label => rows.includes(label)),
    ...kAllPhrases.filter(phrase => rows.some(row => row.startsWith(phrase)))
  ];
};

const editCell = async (page: Page, text: string, newText: string) => {
  await tableCell(page, text).dblclick();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type(newText);
  await page.keyboard.press("Enter");
};

// Tracks the fewest points shown from now on
const trackFewestPoints = async (page: Page) => {
  const pluginPage = page.frames().find(frame => frame.url().startsWith(kPluginUrl))!;
  await pluginPage.evaluate(() => {
    const record = globalThis as unknown as { fewestPoints: number };
    record.fewestPoints = document.querySelectorAll(".point").length;
    new MutationObserver(() => {
      record.fewestPoints = Math.min(record.fewestPoints, document.querySelectorAll(".point").length);
    }).observe(document.body, { childList: true, subtree: true });
  });
  const fewestPoints = () =>
    pluginPage.evaluate(() => (globalThis as unknown as { fewestPoints: number }).fewestPoints);
  return { fewestPoints, pluginPage };
};

// The menu items are chosen with the keyboard, because a click on the header can start a drag
const renameColumn = async (page: Page, name: string, newName: string) => {
  await page.getByRole("button", { name: `Attribute ${name}, open menu`, exact: true }).focus();
  await page.keyboard.press("Enter");
  await page.getByRole("menuitem", { name: /Rename/ }).focus();
  await page.keyboard.press("Enter");
  const nameInput = page.locator(".codap-case-table [data-testid=column-name-input]");
  await nameInput.fill(newName);
  await nameInput.press("Enter");
};

// With reduced motion only the final layout shows, so visible points mean the layout is done.
const openPlot = async (page: Page, labelColumn?: string) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openDocument(page, documentWithPlugin("hierarchical.codap"));
  const plugin = pluginFrame(page);
  await expect.poll(() => optionsOf(plugin, "Data Table")).toEqual(["Phrases"]);
  await choose(plugin, "Data Table", "Phrases");
  await expect.poll(() => optionsOf(plugin, "Phrase Column")).toEqual(["phrase", "notes"]);
  await choose(plugin, "Phrase Column", "phrase");
  if (labelColumn) await choose(plugin, "Label Column", labelColumn);
  await expect(plugin.locator(".graph-plot .point")).toHaveCount(9);
  await expectPointsClearOfZoomButtons(plugin);
  return plugin;
};

test("plots the phrases, then colors them by label without moving them", async ({ page }) => {
  const plugin = await openPlot(page);
  await expect(plot(plugin)).toHaveAccessibleName("t-SNE plot of 9 phrases");
  expect(await keyEntries(plugin)).toEqual(["Unlabeled, 9 phrases"]);
  expect(await dotFill(plugin, "the cat sat on the mat")).toBe("rgb(148, 148, 148)");
  const before = await positions(plugin);

  await choose(plugin, "Label Column", "label");
  await expect.poll(() => keyEntries(plugin))
    .toEqual(["Similar, 3 phrases", "Opposite, 3 phrases", "Sideways, 3 phrases"]);
  // Spec colors, in order of first appearance
  expect(await dotFill(plugin, "the cat sat on the mat")).toBe("rgb(81, 105, 255)");
  expect(await dotFill(plugin, "a dog sprinted outside")).toBe("rgb(178, 28, 0)");
  expect(await dotFill(plugin, "the sparrow called at dawn")).toBe("rgb(238, 102, 0)");
  const keyDots = await plugin.locator(".key-dot").evaluateAll(dots =>
    dots.map(dot => getComputedStyle(dot).backgroundColor));
  expect(keyDots).toEqual(["rgb(81, 105, 255)", "rgb(178, 28, 0)", "rgb(238, 102, 0)"]);
  expect(await positions(plugin)).toEqual(before);
});

test("shows the same plot and Key after the document is saved and reopened", async ({ page }) => {
  const plugin = await openPlot(page, "label");
  await expect.poll(() => keyEntries(plugin)).toHaveLength(3);
  const before = await positions(plugin);
  const key = await keyEntries(plugin);

  const saved = await saveCodapDocument(page);
  await openDocument(page, saved);
  const reopened = pluginFrame(page);
  await expect(reopened.locator(".graph-plot .point")).toHaveCount(9);
  expect(await positions(reopened)).toEqual(before);
  expect(await keyEntries(reopened)).toEqual(key);
});

test("lays out again after a phrase edit, and only recolors after a label edit", async ({ page }) => {
  const plugin = await openPlot(page, "label");
  const before = await positions(plugin);
  const { fewestPoints, pluginPage } = await trackFewestPoints(page);

  // The edit must change which words the phrases share: swapping one unique word for another
  // gives the same TF-IDF numbers, so the same layout.
  await editCell(page, "the cat sat on the mat", "the dog sat outside the house");
  await expect(point(plugin, "the dog sat outside the house")).toBeVisible();
  await expect(point(plugin, "the cat sat on the mat")).toHaveCount(0);
  // The old points cleared before the new layout appeared
  expect(await fewestPoints()).toBe(0);
  const { "the dog sat outside the house": _edited, ...after } = await positions(plugin);
  const { "the cat sat on the mat": _old, ...unedited } = before;
  expect(after).not.toEqual(unedited);

  const laidOut = await positions(plugin);
  await pluginPage.evaluate(() => {
    (globalThis as unknown as { fewestPoints: number }).fewestPoints = document.querySelectorAll(".point").length;
  });
  await editCell(page, "Sideways", "Aside");
  await expect.poll(() => keyEntries(plugin))
    .toEqual(["Similar, 3 phrases", "Opposite, 3 phrases", "Aside, 3 phrases"]);
  expect(await positions(plugin)).toEqual(laidOut);
  expect(await fewestPoints()).toBe(9);
});

test("keeps the plot and the column choices when the chosen columns are renamed", async ({ page }) => {
  const plugin = await openPlot(page, "label");
  const before = await positions(plugin);
  const key = await keyEntries(plugin);
  const { fewestPoints } = await trackFewestPoints(page);

  await renameColumn(page, "phrase", "text");
  await expect(dropdown(plugin, "Phrase Column")).toHaveText("text");
  await renameColumn(page, "label", "category");
  await expect(dropdown(plugin, "Label Column")).toHaveText("category");
  expect(await positions(plugin)).toEqual(before);
  expect(await keyEntries(plugin)).toEqual(key);
  expect(await fewestPoints()).toBe(9);
});

test("mirrors the selection between the plot, the Key and CODAP's table", async ({ page }) => {
  const plugin = await openPlot(page, "label");

  // A point → its row
  await point(plugin, "a dog sprinted outside").click();
  await expect.poll(() => selectedInTable(page)).toEqual(["a dog sprinted outside"]);
  await expect.poll(() => pressedPhrases(plugin)).toEqual(["a dog sprinted outside"]);

  // A Key label → all its rows (CODAP then selects their parent row too)
  await plugin.getByRole("button", { name: /^Similar, 3 phrases/ }).click();
  await expect.poll(() => selectedInTable(page)).toEqual(["Similar", ...kFixturePhrases.Similar]);
  await expect(plugin.getByRole("button", { name: /^Similar, 3 phrases/ })).toHaveAttribute("aria-pressed", "true");

  // As in CODAP's graph: a plain click on a selected point changes nothing, and a Shift-click removes
  // it. Had the plain click narrowed the selection, the Shift-click would leave nothing selected.
  await point(plugin, "the cat sat on the mat").click();
  await point(plugin, "the cat sat on the mat").click({ modifiers: ["Shift"] });
  await expect.poll(() => selectedInTable(page)).toEqual(["a cat rested on a rug", "the kitten lay on the carpet"]);

  // A parent row → all its points
  await tableCell(page, "Sideways").click();
  await expect.poll(() => pressedPhrases(plugin)).toEqual(kFixturePhrases.Sideways);

  // A leaf row → its point
  await tableCell(page, "the cat sat on the mat").click();
  await expect.poll(() => pressedPhrases(plugin)).toEqual(["the cat sat on the mat"]);

  // Empty space in the plot → nothing
  await plot(plugin).click({ position: await emptySpot(plugin) });
  await expect.poll(() => pressedPhrases(plugin)).toEqual([]);
  await expect.poll(() => selectedInTable(page)).toEqual([]);
});

test("selects with the keyboard: arrow to a point, Enter selects, Escape hides the tooltip, then clears",
  async ({ page }) => {
    const plugin = await openPlot(page, "label");
    await tabToPlot(plugin);
    expect(await plotOutline(plugin))
      .toEqual({ outlineStyle: "solid", outlineWidth: "2px", outlineColor: "rgb(9, 87, 208)" });
    await page.keyboard.press("ArrowRight");
    await expect(point(plugin, "the cat sat on the mat")).toBeFocused();
    // Focus is on the point now, so the plot's outline is gone
    expect((await plotOutline(plugin)).outlineStyle).toBe("none");
    // The copy of the active point drawn on top shows the focus ring too
    expect(await plugin.locator(".active-point .focus-ring")
      .evaluate(ring => getComputedStyle(ring).visibility)).toBe("visible");
    await page.keyboard.press("ArrowRight");
    await expect(point(plugin, "a cat rested on a rug")).toBeFocused();
    await page.keyboard.press("Enter");
    await expect.poll(() => selectedInTable(page)).toEqual(["a cat rested on a rug"]);
    await expect(point(plugin, "a cat rested on a rug")).toHaveAttribute("aria-pressed", "true");

    // Shift+Enter adds a point, and removes it again
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("Shift+Enter");
    await expect.poll(() => selectedInTable(page)).toEqual(["the cat sat on the mat", "a cat rested on a rug"]);
    await page.keyboard.press("Shift+Enter");
    await expect.poll(() => selectedInTable(page)).toEqual(["a cat rested on a rug"]);

    await page.keyboard.press("Escape");
    await expect(plugin.getByTestId("point-tooltip")).toHaveCount(0);
    // A clear takes a moment to reach CODAP's table, so a check right away could miss one. No event marks
    // a clear that did not happen, so only a fixed wait can show it.
    // eslint-disable-next-line playwright/no-wait-for-timeout
    await page.waitForTimeout(1000);
    expect(await selectedInTable(page)).toEqual(["a cat rested on a rug"]);
    await page.keyboard.press("Escape");
    await expect.poll(() => selectedInTable(page)).toEqual([]);
    await expect(point(plugin, "a cat rested on a rug")).toHaveAttribute("aria-pressed", "false");
  });

test("lays out a 40-phrase table quickly", { tag: "@performance" }, async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openDocument(page, documentWithPlugin("flat.codap"));
  const plugin = pluginFrame(page);
  await expect.poll(() => optionsOf(plugin, "Data Table")).toEqual(["Phrases"]);
  await choose(plugin, "Data Table", "Phrases");
  await expect.poll(() => optionsOf(plugin, "Phrase Column")).toEqual(["phrase", "label"]);
  const started = Date.now();
  await choose(plugin, "Phrase Column", "phrase");
  await expect(plugin.locator(".graph-plot .point")).toHaveCount(40);
  // Target: final layout within ~3 s of choosing the Phrase Column
  expect(Date.now() - started).toBeLessThan(3000);

  await choose(plugin, "Label Column", "label");
  await expect.poll(() => keyEntries(plugin))
    .toEqual(["Unlabeled, 1 phrase", "Similar, 13 phrases", "Opposite, 13 phrases", "Sideways, 13 phrases"]);
  // For a look at a realistic picture
  const tile = page.locator(".codap-component").filter({ has: page.locator(".codap-web-view-iframe") });
  await test.info().attach("40-phrase plot", { body: await tile.screenshot(), contentType: "image/png" });
});

test("has no accessibility violations with a plot, a Key and a selection", async ({ page }) => {
  const plugin = await openPlot(page, "label");
  await plugin.getByRole("button", { name: /^Similar, 3 phrases/ }).click();
  await expect.poll(() => pressedPhrases(plugin)).toHaveLength(3);
  expect(await axeViolations(page)).toEqual([]);
});

// See the forced-colors rules in key.scss
test("keeps the plot's and the Key's colors, rings and focus visible in forced-colors mode", async ({ page }) => {
  await page.emulateMedia({ forcedColors: "active" });
  const plugin = await openPlot(page, "label");
  const similar = plugin.getByRole("button", { name: /^Similar, 3 phrases/ });
  await similar.click();
  await expect(similar).toHaveAttribute("aria-pressed", "true");

  const style = (selector: string, property: string) => plugin.locator(selector).first().evaluate(
    (el, p) => getComputedStyle(el).getPropertyValue(p), property);
  expect(await style(".key-entry[aria-pressed=true] .key-dot", "background-color")).toBe("rgb(81, 105, 255)");
  expect(await style(".key-entry[aria-pressed=true] .key-dot", "box-shadow")).toContain("rgb(0, 108, 142)");
  expect(await dotFill(plugin, "the cat sat on the mat")).toBe("rgb(81, 105, 255)");
  expect(await point(plugin, "the cat sat on the mat").locator(".selection-ring")
    .evaluate(ring => getComputedStyle(ring).stroke)).toBe("rgb(0, 108, 142)");

  await similar.press("Tab");
  await expect(plugin.locator(".key-entry[data-focus-visible]")).toHaveCount(1);
  expect(await style(".key-entry[data-focus-visible]", "outline-style")).toBe("solid");

  await tabToPlot(plugin);
  expect((await plotOutline(plugin)).outlineStyle).toBe("solid");
});

// Dropping a column header on the table's left drop zone makes it a parent collection, which
// groups and reorders the rows.
const groupByColumn = async (page: Page, column: string) => {
  const source = page.locator(`.codap-case-table [data-testid="codap-attribute-button ${column}"]`);
  const from = await source.boundingBox();
  if (!from) throw new Error(`The ${column} column is not visible`);
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  // Moving over the table first makes CODAP show its drop zones
  await page.mouse.move(from.x + 10, from.y + 40, { steps: 10 });
  const to = await page.locator(".codap-case-table .collection-table-spacer.parentMost").boundingBox();
  if (!to) throw new Error("The table's new-collection drop zone is not visible");
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 20 });
  await page.mouse.up();
};

test("keeps the plot in place when the table is regrouped", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openDocument(page, documentWithPlugin("flat.codap"));
  const plugin = pluginFrame(page);
  await expect.poll(() => optionsOf(plugin, "Data Table")).toEqual(["Phrases"]);
  await choose(plugin, "Data Table", "Phrases");
  await expect.poll(() => optionsOf(plugin, "Phrase Column")).toEqual(["phrase", "label"]);
  await choose(plugin, "Phrase Column", "phrase");
  await choose(plugin, "Label Column", "label");
  await expect(plugin.locator(".graph-plot .point")).toHaveCount(40);
  const before = await positions(plugin);
  const firstPoint = () => plugin.locator(".graph-plot .point").first().getAttribute("aria-label");
  expect(await firstPoint()).toBe("Everyone around the world shares this, Similar");

  // Grouping puts the Similar rows first; same phrases, so same layout
  await groupByColumn(page, "label");
  await expect(page.locator(".codap-case-table .collection-table")).toHaveCount(2);
  await expect.poll(firstPoint).toBe("Everyone around the world shares this, Similar");
  const secondPoint = plugin.locator(".graph-plot .point").nth(1);
  await expect(secondPoint).toHaveAttribute("aria-label", "All people everywhere feel the same, Similar");
  expect(await positions(plugin)).toEqual(before);
});

test("wraps a long Key label to two lines, then cuts it short", async ({ page }) => {
  const plugin = await openPlot(page, "label");
  const entry = (name: RegExp) => plugin.getByRole("button", { name });
  const height = async (name: RegExp) => Math.round((await entry(name).boundingBox())?.height ?? 0);
  // Whether the label's text runs past what is shown
  const isCut = (name: RegExp) => entry(name).locator(".key-label")
    .evaluate(label => label.scrollHeight > label.clientHeight);
  expect(await height(/^Similar,/)).toBe(24);

  await editCell(page, "Sideways", "a somewhat longer label");
  await expect(entry(/^a somewhat longer label,/)).toBeVisible();
  expect(await height(/^a somewhat longer label,/)).toBe(40);
  expect(await isCut(/^a somewhat longer label,/)).toBe(false);

  const tooLong = "a label that is far too long to fit on two lines of the Key";
  await editCell(page, "a somewhat longer label", tooLong);
  await expect(entry(/^a label that is far too long/)).toBeVisible();
  expect(await height(/^a label that is far too long/)).toBe(40);
  expect(await isCut(/^a label that is far too long/)).toBe(true);
  await expect(entry(/^a label that is far too long/).locator(".key-label")).toHaveAttribute("title", tooLong);
  // The other entries keep their height
  expect(await height(/^Similar,/)).toBe(24);
});

test("keeps the plot square and centered when the tile is resized", async ({ page }) => {
  const plugin = await openPlot(page, "label");
  // Retried, because the area and the plot are measured one after the other while CODAP may still
  // be sizing the tile
  const expectSquareAndCentered = async () => {
    let offsets = { left: 0, top: 0 };
    await expect(async () => {
      const { area, plot: square, left, right, top, bottom } = await plotLayout(plugin);
      expect(square.width).toBe(square.height);
      expect(square.width).toBe(Math.min(area.width, area.height));
      expect(Math.abs(left - right)).toBeLessThanOrEqual(1);
      expect(Math.abs(top - bottom)).toBeLessThanOrEqual(1);
      offsets = { left, top };
    }).toPass();
    return offsets;
  };
  expect(await expectSquareAndCentered()).toEqual({ left: 0, top: 0 });

  // Wider: bands on the left and right
  await resizeTileBy(page, 200, 0);
  await expect.poll(async () => (await plotLayout(plugin)).left).toBeGreaterThan(50);
  await expectSquareAndCentered();
  expect(await plugin.getByTestId("graph-area").evaluate(area => getComputedStyle(area).backgroundColor))
    .toBe("rgb(247, 247, 247)");
  expect(await plot(plugin).evaluate(svg => getComputedStyle(svg).backgroundColor)).toBe("rgb(255, 255, 255)");

  // Back to the default width, and taller: bands above and below
  await resizeTileBy(page, -200, 150);
  await expect.poll(async () => (await plotLayout(plugin)).top).toBeGreaterThan(50);
  expect((await expectSquareAndCentered()).left).toBe(0);
});
