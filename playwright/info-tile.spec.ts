import { execSync } from "child_process";
import path from "path";
import { AxeBuilder } from "@axe-core/playwright";
import { expect, type FrameLocator, type Locator, type Page } from "@playwright/test";
import { saveCodapDocument } from "./codap-document";
import { test } from "./fixtures";
import { kCodapUrl, kPluginUrl, openDocument, tileTitled } from "./lib/codap";
import { dropdown, pluginFrame } from "./lib/plugin";

const kInfoTileTitle = "Information: t-SNE Plots";

const infoFrame = (page: Page) => tileTitled(page, kInfoTileTitle).frameLocator(".codap-web-view-iframe");

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
