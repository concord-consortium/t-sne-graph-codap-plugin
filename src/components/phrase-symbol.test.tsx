import React from "react";
import { render, screen } from "@testing-library/react";
import { kPhraseSymbols, PhraseSymbol } from "../models/plugin-store";
import {
  kButtonSymbolExtents, kPlotSymbolExtent, kTestPhraseColor, PhraseSymbolIcon, symbolPath
} from "./phrase-symbol";

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
    it.each([kButtonSymbolExtents[symbol], kPlotSymbolExtent])("is %ipx at its larger side, centered", extent => {
      const { left, right, top, bottom } = box(symbol, extent);
      expect(Math.max(right - left, bottom - top)).toBeCloseTo(extent, 2);
      expect((left + right) / 2).toBeCloseTo(0, 2);
      expect((top + bottom) / 2).toBeCloseTo(0, 2);
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

describe("PhraseSymbolIcon", () => {
  it("draws the symbol in the test-phrase color in a 16px box, hidden from screen readers", () => {
    render(<PhraseSymbolIcon symbol="star" className="symbol" />);
    const svg = screen.getByTestId("phrase-symbol");
    expect(svg).toHaveAttribute("width", "16");
    expect(svg).toHaveAttribute("height", "16");
    expect(svg).toHaveAttribute("viewBox", "-8 -8 16 16");
    expect(svg).toHaveAttribute("aria-hidden", "true");
    expect(svg).toHaveAttribute("data-symbol", "star");
    expect(svg).toHaveClass("symbol");
    const path = screen.getByTestId("phrase-symbol-path");
    expect(path).toHaveAttribute("d", symbolPath("star", kButtonSymbolExtents.star));
    expect(path).toHaveAttribute("fill", kTestPhraseColor);
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
