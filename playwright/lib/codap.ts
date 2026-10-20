import type { Page } from "@playwright/test";

export const kPluginUrl = "https://localhost:8080";
export const kCodapUrl = "https://codap3.concord.org/?mouseSensor&noEntryModal";
// Documents are served to CODAP from this made-up address, which the tests intercept
const kDocumentUrl = "https://documents.test/document.codap";

// A tile's wrapper, which holds its position, size and z-index
export const tileTitled = (page: Page, title: string) => page.locator(".free-tile-component")
  .filter({ has: page.getByTestId("title-text").getByText(title, { exact: true }) });

// Serves `document` at kDocumentUrl and opens it in CODAP
export const openDocument = async (page: Page, document: object) => {
  await page.route(kDocumentUrl, route => route.fulfill({ contentType: "application/json", json: document }));
  await page.goto(`${kCodapUrl}&url=${kDocumentUrl}`);
};
export const tableCell = (page: Page, text: string) =>
  page.locator(".codap-case-table [role=gridcell]", { hasText: text }).first();

// Drags the plugin tile's bottom-right corner
export const resizeTileBy = async (page: Page, dx: number, dy: number) => {
  const tile = page.locator(".codap-component").filter({ has: page.locator(".codap-web-view-iframe") });
  const box = await tile.boundingBox();
  if (!box) throw new Error("The plugin tile is not visible");
  await page.mouse.move(box.x + box.width - 4, box.y + box.height - 4);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 4 + dx, box.y + box.height - 4 + dy, { steps: 10 });
  await page.mouse.up();
};
export const tableSelectionCount = (page: Page) =>
  page.locator(".codap-case-table [role=row][aria-selected=true]").count();
