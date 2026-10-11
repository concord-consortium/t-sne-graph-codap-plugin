import React from "react";
import { PhraseSymbol } from "../models/plugin-store";

export const kTestPhraseColor = "#2e007f";

// Larger side in px. The triangle and star overflow the box slightly; it doesn't clip.
export const kButtonSymbolBox = 16;
export const kButtonSymbolExtents: Record<PhraseSymbol, number> = {
  square: 10.6, triangle: 16.2, diamond: 15, plus: 14.3, star: 17.58
};
export const kPlotSymbolExtents: Record<PhraseSymbol, number> = {
  square: 13.3, triangle: 17.3, diamond: 18.8, plus: 17.8, star: 18.7
};

// Arm width / span
const kPlusArmRatio = 5 / 14;
// Inner / outer radius of a regular star
const kStarInnerRatio = Math.sin(Math.PI / 10) / Math.sin(3 * Math.PI / 10);

const round = (value: number) => Math.round(value * 1000) / 1000;

// Rounded for readable paths in the DOM
const polygon = (points: number[][]) =>
  `M${points.map(([x, y]) => `${round(x)} ${round(y)}`).join("L")}Z`;

// Centered on (0, 0); y points down
const shapes: Record<PhraseSymbol, (extent: number) => number[][]> = {
  square: extent => {
    const h = extent / 2;
    return [[-h, -h], [h, -h], [h, h], [-h, h]];
  },
  // Bounding box centered
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
  // Width = extent; bounding box centered
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

/** Centered on (0, 0); the larger side is `extent`. */
export const symbolPath = (symbol: PhraseSymbol, extent: number) => polygon(shapes[symbol](extent));

interface IPhraseSymbolIconProps {
  symbol: PhraseSymbol;
  className?: string;
}

/** Decorative; its control names it. The outline and rings are the path stroked behind the fill,
 * styled by state in CSS. */
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
