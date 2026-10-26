import { expect, type FrameLocator, type Locator, type Page } from "@playwright/test";
import { test } from "./fixtures";
import { resizeTileBy } from "./lib/codap";
import {
  centerOf, clickPoint, emptySpot, enterTestPhrase, kIsolatedDot, kTestPhrases, moveMouseOff, onPage, plot,
  plotLayout, point, pressedPhrases, symbolPoint, tabToPlot, zoomButton
} from "./lib/plugin";
import { openFlatPlot } from "./lib/documents";
import { axeViolations } from "./lib/accessibility";

// The flat fixture's one dot with no label
const kUnlabeledDot = "People I have never met";
// Under the isolated dot's tooltip
const kCoveredDot = "No one lives in isolation";
// Near the plot's right edge, and near its middle with a long phrase
const kRightEdgeDot = "None of us are by ourselves";
const kMiddleDot = "Everyone around the world shares this";

const tooltip = (plugin: FrameLocator) => plugin.getByTestId("point-tooltip");
// Moves the mouse onto a point's center, without Playwright's check that nothing covers it
const hoverPoint = async (page: Page, plugin: FrameLocator, element: Locator) => {
  const { x, y } = await onPage(plugin, await centerOf(element));
  await page.mouse.move(x, y);
};
const boxCenter = async (element: Locator) => {
  const box = await element.boundingBox();
  if (!box) throw new Error("The element is not visible");
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};
// The border's color is the first (inset) box-shadow's
const tooltipColors = (plugin: FrameLocator) => tooltip(plugin).evaluate(box => {
  const { backgroundColor, boxShadow } = getComputedStyle(box);
  const pointer = box.querySelector("[data-testid=pointer-border]");
  return { fill: backgroundColor, border: /^rgba?\([^)]*\)/.exec(boxShadow)?.[0],
    pointer: pointer && getComputedStyle(pointer).fill };
});
// Read in one step, so all come from the same render
const tooltipFit = (element: Locator) => element.evaluate((p: SVGGElement) => {
  const center = p.getScreenCTM();
  const border = document.querySelector<SVGPolygonElement>("[data-testid=pointer-border]");
  const box = document.querySelector<HTMLElement>("[data-testid=point-tooltip]");
  const area = document.querySelector("[data-testid=graph-area]")?.getBoundingClientRect();
  const ctm = border?.getScreenCTM();
  if (!center || !border || !box || !area || !ctm) throw new Error("No tooltip is showing");
  const tip = border.points[0];
  const rect = box.getBoundingClientRect();
  return {
    tipX: ctm.a * tip.x + ctm.c * tip.y + ctm.e - center.e,
    tipY: ctm.b * tip.x + ctm.d * tip.y + ctm.f - center.f,
    width: rect.width, height: rect.height, side: box.dataset.side,
    inside: rect.left >= area.left && rect.right <= area.right && rect.top >= area.top && rect.bottom <= area.bottom
  };
});
// The colored tip stops 1px short of a dot's center (`kTooltipTipGap`), on the box's side
const expectTipOnDot = ({ tipX, tipY, side }: { tipX: number, tipY: number, side?: string }) => {
  expect(tipX).toBeCloseTo(side === "left" ? -1 : 1, 1);
  expect(tipY).toBeCloseTo(0, 1);
};

test("shows a dot's phrase in its label's colors while the pointer is on it, aimed at its center",
  async ({ page }) => {
    const plugin = await openFlatPlot(page);
    await hoverPoint(page, plugin, point(plugin, kIsolatedDot));
    await expect(tooltip(plugin)).toHaveText(kIsolatedDot);
    // Similar's spec fill, and its dot color for the border and the pointer
    expect(await tooltipColors(plugin))
      .toEqual({ fill: "rgb(192, 207, 255)", border: "rgb(81, 105, 255)", pointer: "rgb(81, 105, 255)" });
    const fit = await tooltipFit(point(plugin, kIsolatedDot));
    expectTipOnDot(fit);
    expect(fit.side).toBe("right");
    expect(fit.inside).toBe(true);
    expect(Math.round(fit.height)).toBe(24);

    const empty = await onPage(plugin, await emptySpot(plugin));
    await page.mouse.move(empty.x, empty.y);
    await expect(tooltip(plugin)).toHaveCount(0);

    await hoverPoint(page, plugin, point(plugin, kUnlabeledDot));
    await expect(tooltip(plugin)).toHaveText(kUnlabeledDot);
    expect(await tooltipColors(plugin))
      .toEqual({ fill: "rgb(209, 209, 209)", border: "rgb(148, 148, 148)", pointer: "rgb(148, 148, 148)" });
  });

test("keeps the tooltip while the mouse is on it, and hides it on Escape until the mouse comes back",
  async ({ page }) => {
    const plugin = await openFlatPlot(page);
    // A click gives the plugin keyboard focus; the mouse stays on the dot
    await clickPoint(point(plugin, kIsolatedDot));
    await expect(tooltip(plugin)).toHaveText(kIsolatedDot);
    const box = await boxCenter(tooltip(plugin));
    await page.mouse.move(box.x, box.y, { steps: 5 });
    await expect(tooltip(plugin)).toHaveText(kIsolatedDot);
    await moveMouseOff(page);
    await expect(tooltip(plugin)).toHaveCount(0);

    await hoverPoint(page, plugin, point(plugin, kIsolatedDot));
    await expect(tooltip(plugin)).toHaveText(kIsolatedDot);
    await page.keyboard.press("Escape");
    await expect(tooltip(plugin)).toHaveCount(0);
    await moveMouseOff(page);
    await hoverPoint(page, plugin, point(plugin, kIsolatedDot));
    await expect(tooltip(plugin)).toHaveText(kIsolatedDot);
  });

// From a point's center, `dy` up or down, then one pointer event per pixel into its tooltip's near edge
const creepToTooltip = async (page: Page, plugin: FrameLocator, element: Locator, dy: number) => {
  const center = await onPage(plugin, await centerOf(element));
  const box = await tooltip(plugin).boundingBox();
  if (!box) throw new Error("The tooltip is not visible");
  const step = await tooltip(plugin).getAttribute("data-side") === "left" ? -1 : 1;
  const end = step > 0 ? box.x + 2 : box.x + box.width - 2;
  for (let x = center.x; (end - x) * step > 0; x += step) await page.mouse.move(x, center.y + dy);
  await page.mouse.move(end, center.y + dy);
};

test("keeps the tooltip while the mouse creeps from a dot or a symbol to it, level with the center or off it",
  async ({ page }) => {
    const plugin = await openFlatPlot(page);
    // The diamond reaches furthest from its center, so its box is furthest from its 12px target
    await enterTestPhrase(plugin, 2, kTestPhrases[2].text);
    for (const [element, text] of [
      [point(plugin, kIsolatedDot), kIsolatedDot], [symbolPoint(plugin, 2), kTestPhrases[2].text]
    ] as const) {
      for (const dy of [0, -8]) {
        await moveMouseOff(page);
        await hoverPoint(page, plugin, element);
        await expect(tooltip(plugin)).toHaveText(text);
        await creepToTooltip(page, plugin, element, dy);
        await expect(tooltip(plugin)).toHaveText(text);
      }
    }
  });

test("puts the tooltip on the left of a dot near the plot's right edge, inside the graph area", async ({ page }) => {
  const plugin = await openFlatPlot(page);
  await hoverPoint(page, plugin, point(plugin, kRightEdgeDot));
  await expect(tooltip(plugin)).toHaveText(kRightEdgeDot);
  const fit = await tooltipFit(point(plugin, kRightEdgeDot));
  expect(fit.side).toBe("left");
  expectTipOnDot(fit);
  expect(fit.inside).toBe(true);
});

test("narrows a long phrase's tooltip over a dot near the middle, so it fits beside the dot", async ({ page }) => {
  const plugin = await openFlatPlot(page);
  await hoverPoint(page, plugin, point(plugin, kMiddleDot));
  await expect(tooltip(plugin)).toHaveText(kMiddleDot);
  const fit = await tooltipFit(point(plugin, kMiddleDot));
  // Narrowed to fit beside the dot, so two lines
  expect(fit.width).toBeLessThan(150);
  expect(Math.round(fit.height)).toBe(40);
  expectTipOnDot(fit);
  expect(fit.inside).toBe(true);
});

test("shows a test phrase in the test-phrase colors, and cuts a long one short at 240px and two lines",
  async ({ page }) => {
    const plugin = await openFlatPlot(page);
    // Wide enough that a 240px box fits beside any point
    await resizeTileBy(page, 260, 0);
    await expect.poll(async () => (await plotLayout(plugin)).left).toBeGreaterThan(100);

    await enterTestPhrase(plugin, 0, kTestPhrases[0].text);
    await hoverPoint(page, plugin, symbolPoint(plugin, 0));
    await expect(tooltip(plugin)).toHaveText(kTestPhrases[0].text);
    expect(await tooltipColors(plugin))
      .toEqual({ fill: "rgb(203, 203, 255)", border: "rgb(46, 0, 127)", pointer: "rgb(46, 0, 127)" });
    // The square's half extent is 7.75px: 1.75px further out than a dot's
    const square = await tooltipFit(symbolPoint(plugin, 0));
    expect(Math.abs(square.tipX)).toBeCloseTo(2.75, 1);
    expect(square.tipY).toBeCloseTo(0, 1);

    const long = `${"people in every country ".repeat(11)}agree`.slice(0, 255);
    await enterTestPhrase(plugin, 1, long);
    await hoverPoint(page, plugin, symbolPoint(plugin, 1));
    await expect(tooltip(plugin)).toHaveText(long);
    const fit = await tooltipFit(symbolPoint(plugin, 1));
    expect(fit.width).toBeCloseTo(240, 0);
    expect(fit.height).toBeCloseTo(40, 0);
    // The ellipsis can't be read, so check that the text is cut
    expect(await plugin.getByTestId("point-tooltip-text").evaluate(text =>
      ({ isCut: text.scrollHeight > text.clientHeight, lines: getComputedStyle(text).webkitLineClamp })))
      .toEqual({ isCut: true, lines: "2" });
  });

test("shows the tooltip for the point the arrow keys reach, and moves it with them", async ({ page }) => {
  const plugin = await openFlatPlot(page);
  await tabToPlot(plugin);
  await expect(tooltip(plugin)).toHaveCount(0);
  const focusedPhrase = () => plugin.locator(".graph-plot .point:focus").evaluate(p =>
    (p.getAttribute("aria-label") ?? "").replace(/, [^,]*$/, ""));
  await page.keyboard.press("ArrowRight");
  const first = await focusedPhrase();
  await expect(tooltip(plugin)).toHaveText(first);
  await page.keyboard.press("ArrowRight");
  const second = await focusedPhrase();
  expect(second).not.toBe(first);
  await expect(tooltip(plugin)).toHaveText(second);
  expectTipOnDot(await tooltipFit(plugin.locator(".graph-plot .point:focus")));
});

// Jest checks that a drag hides the tooltip; here the dots move with the mouse, so it never reaches one
test("places the tooltip at a dot's new position after a zoom and a drag", async ({ page }) => {
  const plugin = await openFlatPlot(page);
  const fit = await centerOf(point(plugin, kMiddleDot));
  await zoomButton(plugin, "Zoom in").click();
  // Wait for the redraw
  await expect.poll(() => centerOf(point(plugin, kMiddleDot))).not.toEqual(fit);
  const before = await centerOf(point(plugin, kMiddleDot));

  const start = await onPage(plugin, await emptySpot(plugin));
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 40, start.y, { steps: 10 });
  await page.mouse.up();
  await expect.poll(async () => (await centerOf(point(plugin, kMiddleDot))).x - before.x).toBeCloseTo(40, 0);

  await hoverPoint(page, plugin, point(plugin, kMiddleDot));
  await expect(tooltip(plugin)).toHaveText(kMiddleDot);
  expectTipOnDot(await tooltipFit(point(plugin, kMiddleDot)));
});

test.describe("tooltips with a touch screen", () => {
  test.use({ hasTouch: true });

  test("shows a tapped dot's tooltip until a tap elsewhere", async ({ page }) => {
    const plugin = await openFlatPlot(page);
    const cdp = await page.context().newCDPSession(page);
    const tap = async (at: { x: number, y: number }) => {
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [at] });
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    };
    const tapPoint = async (phrase: string) => tap(await onPage(plugin, await centerOf(point(plugin, phrase))));

    await tapPoint(kIsolatedDot);
    await expect(point(plugin, kIsolatedDot)).toBeFocused();
    await expect(tooltip(plugin)).toHaveText(kIsolatedDot);
    await expect.poll(() => pressedPhrases(plugin)).toEqual([kIsolatedDot]);

    await tapPoint(kUnlabeledDot);
    await expect(point(plugin, kUnlabeledDot)).toBeFocused();
    await expect(tooltip(plugin)).toHaveText(kUnlabeledDot);
    await expect.poll(() => pressedPhrases(plugin)).toEqual([kUnlabeledDot]);

    await tap(await onPage(plugin, await emptySpot(plugin)));
    await expect(tooltip(plugin)).toHaveCount(0);
    await expect(plot(plugin)).toBeFocused();
    await expect.poll(() => pressedPhrases(plugin)).toEqual([]);

    // A dot under the tooltip's box takes the next tap
    await tapPoint(kIsolatedDot);
    await expect(tooltip(plugin)).toHaveText(kIsolatedDot);
    const covered = await onPage(plugin, await centerOf(point(plugin, kCoveredDot)));
    const box = await tooltip(plugin).boundingBox();
    expect(covered.x > (box?.x ?? 0) && covered.x < (box?.x ?? 0) + (box?.width ?? 0) &&
      covered.y > (box?.y ?? 0) && covered.y < (box?.y ?? 0) + (box?.height ?? 0)).toBe(true);
    await tap(covered);
    await expect(point(plugin, kCoveredDot)).toBeFocused();
    await expect(tooltip(plugin)).toHaveText(kCoveredDot);
    await expect.poll(() => pressedPhrases(plugin)).toEqual([kCoveredDot]);

    await tapPoint(kIsolatedDot);
    await expect(tooltip(plugin)).toHaveText(kIsolatedDot);
    await tap(await boxCenter(zoomButton(plugin, "Zoom in")));
    await expect(tooltip(plugin)).toHaveCount(0);
  });
});

test("has no accessibility violations with a tooltip showing", async ({ page }) => {
  const plugin = await openFlatPlot(page);
  await hoverPoint(page, plugin, point(plugin, kIsolatedDot));
  await expect(tooltip(plugin)).toHaveText(kIsolatedDot);
  expect(await axeViolations(page)).toEqual([]);
});

test("reaches both of two overlapping dots: the pointer picks the nearer center", async ({ page }) => {
  const plugin = await openFlatPlot(page);
  // Zoomed out, the closest two dots overlap
  await zoomButton(plugin, "Zoom out").click();
  const centers = await plugin.locator(".graph-plot .point:not(.test-phrase-point)").evaluateAll(points =>
    points.map(p => {
      const [, x, y] = /translate\((-?[\d.e-]+) (-?[\d.e-]+)\)/.exec(p.getAttribute("transform") ?? "") ?? [];
      return { phrase: (p.getAttribute("aria-label") ?? "").replace(/, [^,]*$/, ""), x: Number(x), y: Number(y) };
    }));
  // In draw order, so `lower` is under `upper`
  let pair = { lower: centers[0], upper: centers[1], distance: Infinity };
  centers.forEach((first, i) => centers.slice(i + 1).forEach(second => {
    const distance = Math.hypot(second.x - first.x, second.y - first.y);
    if (distance < pair.distance) pair = { lower: first, upper: second, distance };
  }));
  // Dots are 13px across with their outlines
  expect(pair.distance).toBeLessThan(13);
  const { lower, upper } = pair;
  // Between the centers, a third of the way from each: both within each dot's 12px pick radius, so only the nearer
  // center decides
  const nearLower = { x: lower.x + (upper.x - lower.x) / 3, y: lower.y + (upper.y - lower.y) / 3 };
  const nearUpper = { x: upper.x + (lower.x - upper.x) / 3, y: upper.y + (lower.y - upper.y) / 3 };

  const move = async (at: { x: number, y: number }) => {
    const { x, y } = await onPage(plugin, at);
    await page.mouse.move(x, y);
  };
  await move(nearLower);
  await expect(tooltip(plugin)).toHaveText(lower.phrase);
  await move(nearUpper);
  await expect(tooltip(plugin)).toHaveText(upper.phrase);

  const click = async (at: { x: number, y: number }) => {
    const { x, y } = await onPage(plugin, at);
    await page.mouse.click(x, y);
  };
  await click(nearLower);
  await expect.poll(() => pressedPhrases(plugin)).toEqual([lower.phrase]);
  await click(nearUpper);
  await expect.poll(() => pressedPhrases(plugin)).toEqual([upper.phrase]);
});
