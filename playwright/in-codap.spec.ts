import { execSync } from "child_process";
import path from "path";
import { AxeBuilder } from "@axe-core/playwright";
import { expect, type FrameLocator, type Locator, type Page } from "@playwright/test";
import { saveCodapDocument } from "./codap-document";
import { test } from "./fixtures";
import { kCodapUrl, kPluginUrl, openDocument, tileTitled } from "./lib/codap";
import { choose, dropdown, optionsOf, pluginFrame } from "./lib/plugin";
import { documentWithPlugin } from "./lib/documents";
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
