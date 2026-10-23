import { expect, type FrameLocator } from "@playwright/test";
import { saveCodapDocument } from "./codap-document";
import { test } from "./fixtures";
import { openDocument, tableSelectionCount } from "./lib/codap";
import {
  choose, clickPoint, emptySpot, onPage, plot, pluginFrame, point, pressedPhrases, zoomButton
} from "./lib/plugin";
import { openFlatPlot } from "./lib/documents";
import { axeViolations } from "./lib/accessibility";

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
  await clickPoint(point(plugin, caseRow));
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
      await clickPoint(point(plugin, "Everyone around the world shares this"));
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
