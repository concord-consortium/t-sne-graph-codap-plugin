import fs from "fs";
import path from "path";
import { AxeBuilder } from "@axe-core/playwright";
import { expect, type FrameLocator, type Page } from "@playwright/test";
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

// Saves the document the way CODAP's own save does, which asks the plugin for its state.
// window.currentDocument is only set when CODAP's `debug` setting includes "document".
const saveDocument = (page: Page) => page.evaluate(async () => {
  interface ICodapDocument {
    prepareSnapshot(): Promise<void>;
    completeSnapshot(): void;
    toJSON(): unknown;
  }
  const codapDocument = (window as unknown as { currentDocument: ICodapDocument }).currentDocument;
  await codapDocument.prepareSnapshot();
  try {
    return JSON.parse(JSON.stringify(codapDocument.toJSON()));
  } finally {
    codapDocument.completeSnapshot();
  }
});

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
  await page.addInitScript(() => window.localStorage.setItem("debug", "document"));
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
  expect(await optionsOf(plugin, "Phrase Column")).toEqual(["Attribute Name"]);

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

  const saved = await saveDocument(page);
  await openDocument(page, saved);

  // Once the column lists have loaded from CODAP, the restored selections are still there.
  // A dropdown with a value lists the "Select" clear item first.
  const reopened = pluginFrame(page);
  await expect.poll(() => optionsOf(reopened, "Phrase Column")).toEqual(["Select", "Attribute Name", "phrase"]);
  await expect(dropdown(reopened, "Data Table")).toHaveText("New Dataset");
  await expect(dropdown(reopened, "Phrase Column")).toHaveText("phrase");
  await expect(dropdown(reopened, "Label Column")).toHaveText("Attribute Name");
});

// The hierarchical fixture (Labels > Phrases), with a plugin tile added. CODAP ignores `di` when
// `url` opens a document, so the plugin has to be in the document itself.
const hierarchicalDocumentWithPlugin = () => {
  const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures/hierarchical.codap"), "utf8"));
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
  await openDocument(page, hierarchicalDocumentWithPlugin());
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

  // An open list, with a value selected so it includes the "Select" clear item
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
