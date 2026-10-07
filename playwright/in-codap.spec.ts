import { expect } from "@playwright/test";
import { test } from "./fixtures";

// Temporary smoke test until CODAP-1555 step 8 adds the data source tests
test("App inside of CODAP", async ({page}) => {
  await page.setViewportSize({width: 1400, height: 800});
  await page.goto("https://codap3.concord.org/?mouseSensor&di=https://localhost:8080");

  // CODAP shows the plugin name in the tile's title bar
  await expect(page.getByTestId("component-title-bar")).toContainText("t-SNE Plot");
  await expect(page.locator(".codap-web-view-iframe")).toBeVisible();
});
