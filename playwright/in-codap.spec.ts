import fs from "fs";
import path from "path";
import { AxeBuilder } from "@axe-core/playwright";
import { expect, type FrameLocator, type Page } from "@playwright/test";
import { exposeCodapDocument, saveCodapDocument } from "./codap-document";
import { test } from "./fixtures";
import { kHierarchicalPhrases as kFixturePhrases } from "./fixtures/hierarchical-phrases";

const kPluginUrl = "https://localhost:8080";
const kCodapUrl = "https://codap3.concord.org/?mouseSensor&noEntryModal";
// Documents are served to CODAP from this made-up address, which the tests intercept
const kDocumentUrl = "https://documents.test/document.codap";

const pluginFrame = (page: Page) => page.frameLocator(".codap-web-view-iframe");

// While a dropdown's list is open, React Aria hides the rest of the plugin from screen readers,
// so the buttons are found with includeHidden
const dropdown = (plugin: FrameLocator, label: string) =>
  plugin.getByRole("button", { name: new RegExp(label), includeHidden: true });

// Opens a dropdown, reads its options, and closes it again
const optionsOf = async (plugin: FrameLocator, label: string) => {
  await dropdown(plugin, label).click();
  const options = await plugin.getByRole("option").allTextContents();
  await plugin.locator("body").press("Escape");
  return options;
};

const choose = async (plugin: FrameLocator, label: string, option: string) => {
  await dropdown(plugin, label).click();
  await plugin.getByRole("option", { name: option, exact: true }).click();
};

// Serves `document` at kDocumentUrl and opens it in CODAP
const openDocument = async (page: Page, document: object) => {
  await page.route(kDocumentUrl, route => route.fulfill({ contentType: "application/json", json: document }));
  await page.goto(`${kCodapUrl}&url=${kDocumentUrl}`);
};

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

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 800 });
  await exposeCodapDocument(page);
});

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

// A fixture document with a plugin tile added
const documentWithPlugin = (file: string) => {
  const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", file), "utf8"));
  const pluginTileId = "WEBVtsnePlugin";
  const row = Object.values(fixture.content.rowMap)[0] as { tiles: Record<string, object> };
  row.tiles[pluginTileId] = { tileId: pluginTileId, x: 420, y: 5, width: 680, height: 334, zIndex: 2 };
  fixture.content.tileMap[pluginTileId] = {
    id: pluginTileId, name: "t-SNE Plot", content: { type: "CodapWebView", subType: "plugin", url: kPluginUrl }
  };
  return fixture;
};

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

// Each WCAG 2 A/AA violation in the plugin, as its rule and the elements it flagged, so a failure is
// readable. Only the plugin's frame is checked, not CODAP. axe's best-practice rules (a main
// landmark, an h1) are left out: they suit whole pages, and the plugin is a tile inside CODAP, which
// shows the title.
const axeViolations = async (page: Page) => {
  const { violations } = await new AxeBuilder({ page })
    .include([".codap-web-view-iframe", "body"])
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  return violations.map(({ id, nodes }) => ({ id, elements: nodes.map(node => node.target.join(" ")) }));
};

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

// ---- The plot and the Key ----

const kAllPhrases = Object.values(kFixturePhrases).flat();

const plot = (plugin: FrameLocator) => plugin.getByRole("group", { name: /^t-SNE plot/ });
// A point's name is its phrase, then ", label" when there is a Label Column
const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const point = (plugin: FrameLocator, phrase: string) =>
  plugin.getByRole("button", { name: new RegExp(`^${escapeRegExp(phrase)}(, [^,]*)?$`) });
const keyEntries = (plugin: FrameLocator) =>
  plugin.getByRole("region", { name: "Key" }).getByRole("button").evaluateAll(buttons =>
    buttons.map(button => button.getAttribute("aria-label")));
// Each point's position, by phrase (its name without the label)
const positions = (plugin: FrameLocator) => plugin.locator(".graph-plot .point").evaluateAll(points =>
  Object.fromEntries(points.map(p =>
    [(p.getAttribute("aria-label") ?? "").replace(/, [^,]*$/, ""), p.getAttribute("transform")])));
// Shift+Tab from the first dropdown reaches the plot by keyboard, which shows :focus-visible styles
const tabToPlot = async (plugin: FrameLocator) => {
  await dropdown(plugin, "Data Table").focus();
  await dropdown(plugin, "Data Table").press("Shift+Tab");
  await expect(plot(plugin)).toBeFocused();
};
const plotOutline = (plugin: FrameLocator) => plot(plugin).evaluate(svg => {
  const { outlineStyle, outlineWidth, outlineColor } = getComputedStyle(svg);
  return { outlineStyle, outlineWidth, outlineColor };
});
const dotFill = (plugin: FrameLocator, phrase: string) =>
  point(plugin, phrase).locator(".dot").evaluate(dot => getComputedStyle(dot).fill);
const pressedPhrases = (plugin: FrameLocator) =>
  plugin.locator(".graph-plot .point[aria-pressed=true]").evaluateAll(points =>
    points.map(p => (p.getAttribute("aria-label") ?? "").replace(/, [^,]*$/, "")));
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
const tableCell = (page: Page, text: string) =>
  page.locator(".codap-case-table [role=gridcell]", { hasText: text }).first();
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
  return plugin;
};

// More than 20px from every point
const emptySpot = async (plugin: FrameLocator) => {
  const centers = await plugin.locator(".graph-plot .point").evaluateAll(points => points.map(p => {
    const [, x, y] = /translate\(([\d.]+) ([\d.]+)\)/.exec(p.getAttribute("transform") ?? "") ?? [];
    return { x: Number(x), y: Number(y) };
  }));
  for (let y = 20; y < 300; y += 20) {
    for (let x = 20; x < 300; x += 20) {
      if (centers.every(c => Math.hypot(c.x - x, c.y - y) > 20)) return { x, y };
    }
  }
  throw new Error("The plot has no empty space");
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

test("selects with the keyboard: arrow to a point, Enter selects, Escape clears", async ({ page }) => {
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
  await expect.poll(() => selectedInTable(page)).toEqual([]);
  await expect(point(plugin, "a cat rested on a rug")).toHaveAttribute("aria-pressed", "false");
});

test("lays out a 40-phrase table quickly", async ({ page }) => {
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

// Drags the plugin tile's bottom-right corner
const resizeTileBy = async (page: Page, dx: number, dy: number) => {
  const tile = page.locator(".codap-component").filter({ has: page.locator(".codap-web-view-iframe") });
  const box = await tile.boundingBox();
  if (!box) throw new Error("The plugin tile is not visible");
  await page.mouse.move(box.x + box.width - 4, box.y + box.height - 4);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 4 + dx, box.y + box.height - 4 + dy, { steps: 10 });
  await page.mouse.up();
};

// The graph area's and the plot's sizes, and the plot's offsets from the area's edges, in whole pixels
const plotLayout = async (plugin: FrameLocator) => {
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

// ---- Test phrases ----

// Each test phrase's nearest phrase in the flat fixture, by the plugin's TF-IDF
const kTestPhrases = [
  { text: "kids who ride the bus", neighbor: "Kids who ride my bus" },
  { text: "nobody walks this road", neighbor: "Nobody walks this road alone" },
  { text: "people from every country", neighbor: "People in every country agree" },
  { text: "a few close friends", neighbor: "A few of my closest friends" },
  { text: "every person in the world", neighbor: "Each person in every nation" }
];
const kSymbols = ["square", "triangle", "diamond", "plus", "star"];
const kNoWordsText = "No words in common with the table's phrases";
// The spec's minimum distance from a symbol to its neighbor's dot
const kMinNeighborOffset = 18;

const testField = (plugin: FrameLocator, slot: number) =>
  plugin.getByRole("textbox", { name: `Test phrase ${slot + 1}` });
const symbolButton = (plugin: FrameLocator, slot: number) =>
  plugin.getByRole("region", { name: "Test Phrases" }).getByRole("button").nth(slot);
const symbolPoint = (plugin: FrameLocator, slot: number) =>
  plugin.locator(`.test-phrase-point[data-symbol=${kSymbols[slot]}]`);
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
const tableSelectionCount = (page: Page) =>
  page.locator(".codap-case-table [role=row][aria-selected=true]").count();

// Types a phrase and leaves the field with Tab, which commits it
const enterTestPhrase = async (plugin: FrameLocator, slot: number, text: string) => {
  await testField(plugin, slot).fill(text);
  await testField(plugin, slot).press("Tab");
};

// The flat fixture with the plot done and colored by label
const openFlatPlot = async (page: Page, document: object = documentWithPlugin("flat.codap")) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openDocument(page, document);
  const plugin = pluginFrame(page);
  await expect.poll(() => optionsOf(plugin, "Data Table")).toEqual(["Phrases"]);
  await choose(plugin, "Data Table", "Phrases");
  await expect.poll(() => optionsOf(plugin, "Phrase Column")).toEqual(["phrase", "label"]);
  await choose(plugin, "Phrase Column", "phrase");
  await choose(plugin, "Label Column", "label");
  await expect(plugin.locator(".graph-plot .point:not(.test-phrase-point)")).toHaveCount(40);
  return plugin;
};

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
