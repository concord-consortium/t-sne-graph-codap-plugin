import React from "react";
import { PhraseSymbol } from "../models/plugin-store";

export const kTestPhraseColor = "#2e007f";

// Each shape's width or height, whichever is larger, in px, from the spec's measurements. The
// triangle (16.2 × 14) and the star (17.58 × 16.72) are a little wider than the box; it doesn't clip.
export const kButtonSymbolBox = 16;
export const kButtonSymbolExtents: Record<PhraseSymbol, number> = {
  square: 10.6, triangle: 16.2, diamond: 15, plus: 14.3, star: 17.58
};
// The spec's plot square fills a dot's 12px, so every plot shape does
export const kPlotSymbolExtent = 12;

// Arm width over span, from the spec's 5 of 14px
const kPlusArmRatio = 5 / 14;
// Inner over outer radius of a regular five-point star
const kStarInnerRatio = Math.sin(Math.PI / 10) / Math.sin(3 * Math.PI / 10);

const round = (value: number) => Math.round(value * 1000) / 1000;

// Closed path through the points, each [x, y], rounded so paths read cleanly in the DOM
const polygon = (points: number[][]) =>
  `M${points.map(([x, y]) => `${round(x)} ${round(y)}`).join("L")}Z`;

// Centered on (0, 0); y grows downward, as in SVG
const shapes: Record<PhraseSymbol, (extent: number) => number[][]> = {
  square: extent => {
    const h = extent / 2;
    return [[-h, -h], [h, -h], [h, h], [-h, h]];
  },
  // Equilateral, pointing up, with its box centered
  triangle: extent => {
    const h = extent / 2;
    const height = extent * Math.sqrt(3) / 2;
    return [[0, -height / 2], [h, height / 2], [-h, height / 2]];
  },
  diamond: extent => {
    const h = extent / 2;
    return [[0, -h], [h, 0], [0, h], [-h, 0]];
  },
  plus: extent => {
    const h = extent / 2;
    const a = extent * kPlusArmRatio / 2;
    return [[-a, -h], [a, -h], [a, -a], [h, -a], [h, a], [a, a], [a, h], [-a, h], [-a, a], [-h, a], [-h, -a], [-a, -a]];
  },
  // Point up; scaled so its width is the extent, then its box centered
  star: extent => {
    const outer = extent / (2 * Math.sin(2 * Math.PI / 5));
    const inner = outer * kStarInnerRatio;
    const top = -outer;
    const bottom = outer * Math.cos(Math.PI / 5);
    const shift = -(top + bottom) / 2;
    return Array.from({ length: 10 }, (_value, i) => {
      const radius = i % 2 === 0 ? outer : inner;
      const angle = i * Math.PI / 5;
      return [radius * Math.sin(angle), -radius * Math.cos(angle) + shift];
    });
  }
};

/** The symbol's SVG path, centered on (0, 0), at most `extent` wide and tall. */
export const symbolPath = (symbol: PhraseSymbol, extent: number) => polygon(shapes[symbol](extent));

interface IPhraseSymbolIconProps {
  symbol: PhraseSymbol;
  className?: string;
}

/** The symbol in a 16px box, as next to a test-phrase field. Decorative: the control names it.
 * Behind the fill, the same path is stroked for the outline and the selection ring and edge: a
 * centered stroke reaches half its width outside, so each follows the symbol's shape. CSS sets
 * their strokes by state. */
export const PhraseSymbolIcon = ({ symbol, className }: IPhraseSymbolIconProps) => {
  const half = kButtonSymbolBox / 2;
  const path = symbolPath(symbol, kButtonSymbolExtents[symbol]);
  return (
    <svg className={className} width={kButtonSymbolBox} height={kButtonSymbolBox}
      viewBox={`${-half} ${-half} ${kButtonSymbolBox} ${kButtonSymbolBox}`} aria-hidden="true"
      data-symbol={symbol} data-testid="phrase-symbol">
      <path className="symbol-selection-edge" d={path} />
      <path className="symbol-selection-ring" d={path} />
      <path className="symbol-outline" d={path} />
      <path className="symbol-fill" d={path} fill={kTestPhraseColor} data-testid="phrase-symbol-path" />
    </svg>
  );
};
