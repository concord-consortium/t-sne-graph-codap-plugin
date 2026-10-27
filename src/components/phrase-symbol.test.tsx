import React from "react";
import { render, screen } from "@testing-library/react";
import { kPhraseSymbols, PhraseSymbol } from "../models/plugin-store";
import { kTestPhraseColor } from "../tsne/labels";
import { kMinNeighborOffsetPx } from "../tsne/layout";
import { kButtonSymbolExtents, kPlotSymbolExtents, PhraseSymbolIcon, symbolPath, symbolReach } from "./phrase-symbol";

// The [x, y] points of an "M x yL x y…Z" path
const points = (path: string) =>
  path.replace(/^M|Z$/g, "").split("L").map(point => point.split(" ").map(Number));

const box = (symbol: PhraseSymbol, extent: number) => {
  const xs = points(symbolPath(symbol, extent)).map(([x]) => x);
  const ys = points(symbolPath(symbol, extent)).map(([, y]) => y);
  return { left: Math.min(...xs), right: Math.max(...xs), top: Math.min(...ys), bottom: Math.max(...ys) };
};

describe("symbolPath", () => {
  describe.each(kPhraseSymbols.map(symbol => [symbol]))("%s", symbol => {
    it.each([kButtonSymbolExtents[symbol], kPlotSymbolExtents[symbol]])(
      "is %fpx at its larger side, centered on its centroid", extent => {
        const { left, right, top, bottom } = box(symbol, extent);
        expect(Math.max(right - left, bottom - top)).toBeCloseTo(extent, 2);
        // Every shape is regular or symmetric, so its centroid is the mean of its points
        const corners = points(symbolPath(symbol, extent));
        expect(corners.reduce((sum, [x]) => sum + x, 0) / corners.length).toBeCloseTo(0, 2);
        expect(corners.reduce((sum, [, y]) => sum + y, 0) / corners.length).toBeCloseTo(0, 2);
      });

    it("reports its reach as its farthest point from the center", () => {
      const extent = kPlotSymbolExtents[symbol];
      const farthest = Math.max(...points(symbolPath(symbol, extent)).map(([x, y]) => Math.hypot(x, y)));
      expect(symbolReach(symbol, extent)).toBeCloseTo(farthest, 2);
    });

    it("fits the 24px symbol button", () => {
      const { left, right, top, bottom } = box(symbol, kButtonSymbolExtents[symbol]);
      [left, right, top, bottom].forEach(value => expect(Math.abs(value)).toBeLessThanOrEqual(12));
    });
  });

  it("draws a square as four corners", () => {
    expect(symbolPath("square", 12)).toBe("M-6 -6L6 -6L6 6L-6 6Z");
  });

  it("draws a diamond as a square turned 45°", () => {
    expect(symbolPath("diamond", 12)).toBe("M0 -6L6 0L0 6L-6 0Z");
  });

  it("points the triangle up, with equal sides", () => {
    const [apex, right, left] = points(symbolPath("triangle", 14));
    expect(apex[0]).toBe(0);
    expect(apex[1]).toBeLessThan(right[1]);
    const side = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1]);
    expect(side(apex, right)).toBeCloseTo(14, 2);
    expect(side(apex, left)).toBeCloseTo(14, 2);
    expect(side(left, right)).toBeCloseTo(14, 2);
  });

  it("draws a plus with arms 5/14 of its span", () => {
    const xs = points(symbolPath("plus", 14)).map(([x]) => x);
    expect(points(symbolPath("plus", 14))).toHaveLength(12);
    expect(xs).toContain(2.5);
    expect(xs).toContain(-2.5);
  });

  it.each([
    ["square", 10.6, 10.6], ["triangle", 16.2, 14], ["diamond", 15, 15], ["plus", 14.3, 14.3], ["star", 17.58, 16.72]
  ] as const)("draws the %s at the spec's %f × %f in the button", (symbol, width, height) => {
    const { left, right, top, bottom } = box(symbol, kButtonSymbolExtents[symbol]);
    expect(right - left).toBeCloseTo(width, 2);
    // The triangle's 14 is the spec's rounding of an equilateral 14.03
    expect(bottom - top).toBeCloseTo(height, symbol === "triangle" ? 1 : 2);
  });

  it("draws a five-point star, point up", () => {
    const star = points(symbolPath("star", 16));
    expect(star).toHaveLength(10);
    expect(star[0][0]).toBeCloseTo(0, 3);
    expect(star[0][1]).toBe(Math.min(...star.map(([, y]) => y)));
  });
});

describe("plot symbols", () => {
  it("are each pushed far enough from the neighbor's 6px-radius dot to leave it uncovered", () => {
    kPhraseSymbols.forEach(symbol => {
      expect(symbolReach(symbol, kPlotSymbolExtents[symbol]) + 6).toBeLessThan(kMinNeighborOffsetPx);
    });
  });

  it("reach at most 11px, so two 18px apart overlap by at most 4px", () => {
    kPhraseSymbols.forEach(symbol => expect(symbolReach(symbol, kPlotSymbolExtents[symbol])).toBeLessThanOrEqual(11));
    // An equilateral triangle centered on its centroid reaches side / √3
    expect(symbolReach("triangle", 17.3)).toBeCloseTo(17.3 / Math.sqrt(3), 2);
  });
});

describe("PhraseSymbolIcon", () => {
  it("draws the symbol in the test-phrase color in a 16px box, hidden from screen readers", () => {
    render(<PhraseSymbolIcon symbol="square" className="symbol" />);
    const svg = screen.getByTestId("phrase-symbol");
    expect(svg).toHaveAttribute("width", "16");
    expect(svg).toHaveAttribute("height", "16");
    expect(svg).toHaveAttribute("viewBox", "-8 -8 16 16");
    expect(svg).toHaveAttribute("aria-hidden", "true");
    expect(svg).toHaveAttribute("data-symbol", "square");
    expect(svg).toHaveClass("symbol");
    const path = screen.getByTestId("phrase-symbol-path");
    expect(path).toHaveAttribute("d", symbolPath("square", kButtonSymbolExtents.square));
    expect(path).toHaveAttribute("fill", kTestPhraseColor);
  });

  it.each(kPhraseSymbols.map(symbol => [symbol]))(
    "centers the %s on the middle of its height, so it lines up with the field", symbol => {
      render(<PhraseSymbolIcon symbol={symbol} />);
      const [, viewTop, , viewHeight] = screen.getByTestId("phrase-symbol").getAttribute("viewBox")!
        .split(" ").map(Number);
      const { top, bottom } = box(symbol, kButtonSymbolExtents[symbol]);
      expect(top - viewTop).toBeCloseTo(viewTop + viewHeight - bottom, 2);
    });

  it("draws a focus ring in the symbol's shape, outside the selection ring and the dimmed body", () => {
    render(<PhraseSymbolIcon symbol="diamond" />);
    const path = symbolPath("diamond", kButtonSymbolExtents.diamond);
    const focusRing = screen.getByTestId("focus-ring");
    expect(focusRing).toHaveAttribute("d", path);
    expect(focusRing).toHaveStyle({ strokeWidth: "12" });
    const mask = screen.getByTestId("focus-mask");
    expect(focusRing).toHaveAttribute("mask", `url(#${mask.id})`);
    // Kept out to 6px outside the symbol, cut away up to the selection edge, 4px outside
    expect(screen.getByTestId("focus-mask-outer")).toHaveAttribute("stroke-width", "12");
    expect(screen.getByTestId("focus-mask-inner")).toHaveAttribute("stroke-width", "8");
    // At the diamond's 90° tips the 12px stroke reaches 6 × √2 past the path
    const ringReach = symbolReach("diamond", kButtonSymbolExtents.diamond) + 6 * Math.SQRT2;
    expect(Number(mask.getAttribute("width"))).toBeGreaterThanOrEqual(2 * ringReach);
    const body = screen.getByTestId("phrase-symbol-body");
    expect(body).toContainElement(screen.getByTestId("phrase-symbol-path"));
    expect(body).not.toContainElement(focusRing);
  });

  it("draws each symbol at its spec size", () => {
    kPhraseSymbols.forEach(symbol => {
      const { unmount } = render(<PhraseSymbolIcon symbol={symbol} />);
      expect(screen.getByTestId("phrase-symbol-path"))
        .toHaveAttribute("d", symbolPath(symbol, kButtonSymbolExtents[symbol]));
      unmount();
    });
  });
});
