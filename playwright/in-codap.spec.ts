import fs from "fs";
import path from "path";
import { AxeBuilder } from "@axe-core/playwright";
import { expect, type FrameLocator, type Page } from "@playwright/test";
import { exposeCodapDocument, saveCodapDocument } from "./codap-document";
import { test } from "./fixtures";

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

// A fixture document with a plugin tile added. CODAP ignores `di` when `url` opens a document, so
// the plugin has to be in the document itself.
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

// The hierarchical fixture's phrases by label, in table order
const kFixturePhrases: Record<string, string[]> = {
  Similar: ["the cat sat on the mat", "a cat rested on a rug", "the kitten lay on the carpet"],
  Opposite: ["the dog ran from the house", "a dog sprinted outside", "the puppy fled the yard"],
  Sideways: ["the bird sang in the tree", "a bird chirped on a branch", "the sparrow called at dawn"]
};
const kAllPhrases = Object.values(kFixturePhrases).flat();

const plot = (plugin: FrameLocator) => plugin.getByRole("group", { name: /^t-SNE plot/ });
const point = (plugin: FrameLocator, phrase: string) => plugin.getByRole("button", { name: phrase, exact: true });
const keyEntries = (plugin: FrameLocator) =>
  plugin.getByRole("region", { name: "Key" }).getByRole("button").evaluateAll(buttons =>
    buttons.map(button => button.getAttribute("aria-label")));
const positions = (plugin: FrameLocator) => plugin.locator(".graph-plot .point").evaluateAll(points =>
  Object.fromEntries(points.map(p => [p.getAttribute("aria-label"), p.getAttribute("transform")])));
const dotFill = (plugin: FrameLocator, phrase: string) =>
  point(plugin, phrase).locator(".dot").evaluate(dot => getComputedStyle(dot).fill);
const pressedPhrases = (plugin: FrameLocator) =>
  plugin.locator(".graph-plot .point[aria-pressed=true]").evaluateAll(points =>
    points.map(p => p.getAttribute("aria-label")));
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

// At least 20px from every point
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
  await expect(plot(plugin)).toHaveAccessibleName("t-SNE plot of 9 phrases in 1 label");
  expect(await keyEntries(plugin)).toEqual(["Unlabeled, 9 points"]);
  expect(await dotFill(plugin, "the cat sat on the mat")).toBe("rgb(148, 148, 148)");
  const before = await positions(plugin);

  await choose(plugin, "Label Column", "label");
  await expect.poll(() => keyEntries(plugin))
    .toEqual(["Similar, 3 points", "Opposite, 3 points", "Sideways, 3 points"]);
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
  // Track the fewest points shown from here on
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
  await expect.poll(() => keyEntries(plugin)).toEqual(["Similar, 3 points", "Opposite, 3 points", "Aside, 3 points"]);
  expect(await positions(plugin)).toEqual(laidOut);
  expect(await fewestPoints()).toBe(9);
});

test("mirrors the selection between the plot, the Key and CODAP's table", async ({ page }) => {
  const plugin = await openPlot(page, "label");

  // A point → its row
  await point(plugin, "a dog sprinted outside").click();
  await expect.poll(() => selectedInTable(page)).toEqual(["a dog sprinted outside"]);
  await expect.poll(() => pressedPhrases(plugin)).toEqual(["a dog sprinted outside"]);

  // A Key label → all its rows (CODAP then selects their parent row too)
  await plugin.getByRole("button", { name: /^Similar, 3 points/ }).click();
  await expect.poll(() => selectedInTable(page)).toEqual(["Similar", ...kFixturePhrases.Similar]);
  await expect(plugin.getByRole("button", { name: /^Similar, 3 points/ })).toHaveAttribute("aria-pressed", "true");

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
  await plot(plugin).focus();
  await plot(plugin).press("ArrowRight");
  await expect(point(plugin, "the cat sat on the mat")).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(point(plugin, "a cat rested on a rug")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect.poll(() => selectedInTable(page)).toEqual(["a cat rested on a rug"]);
  await expect(point(plugin, "a cat rested on a rug")).toHaveAttribute("aria-pressed", "true");

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
  // Target: final layout within ~3 s, fetch included
  expect(Date.now() - started).toBeLessThan(3000);

  await choose(plugin, "Label Column", "label");
  await expect.poll(() => keyEntries(plugin))
    .toEqual(["Unlabeled, 1 point", "Similar, 13 points", "Opposite, 13 points", "Sideways, 13 points"]);
  // For a look at a realistic picture
  const tile = page.locator(".codap-component").filter({ has: page.locator(".codap-web-view-iframe") });
  await test.info().attach("40-phrase plot", { body: await tile.screenshot(), contentType: "image/png" });
});

test("has no accessibility violations with a plot, a Key and a selection", async ({ page }) => {
  const plugin = await openPlot(page, "label");
  await plugin.getByRole("button", { name: /^Similar, 3 points/ }).click();
  await expect.poll(() => pressedPhrases(plugin)).toHaveLength(3);
  expect(await axeViolations(page)).toEqual([]);
});

// Forced colors replace backgrounds and drop box-shadows, which the Key's dots, rings and focus
// border use. SVG colors are left alone.
test("keeps the plot's and the Key's colors, rings and focus visible in forced-colors mode", async ({ page }) => {
  await page.emulateMedia({ forcedColors: "active" });
  const plugin = await openPlot(page, "label");
  const similar = plugin.getByRole("button", { name: /^Similar, 3 points/ });
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
  expect(await firstPoint()).toBe("Everyone around the world shares this");

  // Grouping puts the Similar rows first; same phrases, so same layout
  await groupByColumn(page, "label");
  await expect(page.locator(".codap-case-table .collection-table")).toHaveCount(2);
  await expect.poll(firstPoint).toBe("Everyone around the world shares this");
  const secondPoint = plugin.locator(".graph-plot .point").nth(1);
  await expect(secondPoint).toHaveAttribute("aria-label", "All people everywhere feel the same");
  expect(await positions(plugin)).toEqual(before);
});
