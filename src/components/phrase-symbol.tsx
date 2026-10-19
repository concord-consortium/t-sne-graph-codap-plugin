import React, { useId } from "react";
import { PhraseSymbol } from "../models/plugin-store";
import { kTestPhraseColor } from "../tsne/labels";

// Larger side in px. The triangle and star overflow the box slightly; it doesn't clip.
export const kButtonSymbolBox = 16;
export const kButtonSymbolExtents: Record<PhraseSymbol, number> = {
  square: 10.6, triangle: 16.2, diamond: 15, plus: 14.3, star: 17.58
};
export const kPlotSymbolExtents: Record<PhraseSymbol, number> = {
  square: 13.3, triangle: 17.3, diamond: 18.8, plus: 17.8, star: 18.7
};

// Symbol rings are its path stroked; half of each width lands outside. Set inline on the plot, or the
// dots' CSS widths win.
export const kSymbolOutlineWidth = 2;
export const kSymbolRingWidth = 6;
export const kSymbolEdgeWidth = 8;
export const kSymbolFocusOuterWidth = 12;

// Arm width / span
const kPlusArmRatio = 5 / 14;
// Inner / outer radius of a regular star
const kStarInnerRatio = Math.sin(Math.PI / 10) / Math.sin(3 * Math.PI / 10);

const round = (value: number) => Math.round(value * 1000) / 1000;

// Rounded for readable paths in the DOM
const polygon = (points: number[][]) =>
  `M${points.map(([x, y]) => `${round(x)} ${round(y)}`).join("L")}Z`;

// Centered on the centroid at (0, 0), where we see a shape sit, so it lines up with the dots and its
// farthest reach is least; y points down
const shapes: Record<PhraseSymbol, (extent: number) => number[][]> = {
  square: extent => {
    const h = extent / 2;
    return [[-h, -h], [h, -h], [h, h], [-h, h]];
  },
  triangle: extent => {
    const h = extent / 2;
    const height = extent * Math.sqrt(3) / 2;
    return [[0, -height * 2 / 3], [h, height / 3], [-h, height / 3]];
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
  // Width = extent
  star: extent => {
    const outer = extent / (2 * Math.sin(2 * Math.PI / 5));
    const inner = outer * kStarInnerRatio;
    return Array.from({ length: 10 }, (_value, i) => {
      const radius = i % 2 === 0 ? outer : inner;
      const angle = i * Math.PI / 5;
      return [radius * Math.sin(angle), -radius * Math.cos(angle)];
    });
  }
};

export const symbolName = (symbol: PhraseSymbol) => symbol.charAt(0).toUpperCase() + symbol.slice(1);

/** Centered on its centroid at (0, 0); the larger side is `extent`. */
export const symbolPath = (symbol: PhraseSymbol, extent: number) => polygon(shapes[symbol](extent));

/** How far the path reaches from (0, 0). */
export const symbolReach = (symbol: PhraseSymbol, extent: number) =>
  Math.max(...shapes[symbol](extent).map(([x, y]) => Math.hypot(x, y)));

/** The y of the middle of the path's height; above 0 for the triangle and the star. */
export const symbolMiddleY = (symbol: PhraseSymbol, extent: number) => {
  const ys = shapes[symbol](extent).map(([, y]) => y);
  return (Math.min(...ys) + Math.max(...ys)) / 2;
};

interface ISymbolFocusRingProps {
  symbol: PhraseSymbol;
  extent: number;
}

/** 4–6px outside the symbol's edges, outside the selection ring: a wide stroke with its inner part
 * masked out. Styled in CSS. */
export const SymbolFocusRing = ({ symbol, extent }: ISymbolFocusRingProps) => {
  const maskId = useId();
  const path = symbolPath(symbol, extent);
  // The ring's reach, plus 1px: half the stroke past the path, or up to √2 times that at a mitered 90°
  // corner. Too big is harmless.
  const maskSize = 2 * (symbolReach(symbol, extent) + kSymbolFocusOuterWidth / 2 * Math.SQRT2 + 1);
  const maskOrigin = -maskSize / 2;
  return (
    <>
      <mask id={maskId} data-testid="focus-mask" maskUnits="userSpaceOnUse" x={maskOrigin} y={maskOrigin}
        width={maskSize} height={maskSize}>
        <path d={path} fill="white" stroke="white" strokeWidth={kSymbolFocusOuterWidth}
          data-testid="focus-mask-outer" />
        <path d={path} fill="black" stroke="black" strokeWidth={kSymbolEdgeWidth}
          data-testid="focus-mask-inner" />
      </mask>
      <path className="focus-ring" data-testid="focus-ring" d={path} mask={`url(#${maskId})`}
        style={{ strokeWidth: kSymbolFocusOuterWidth }} />
    </>
  );
};

interface IPhraseSymbolIconProps {
  symbol: PhraseSymbol;
  className?: string;
}

/** Decorative; its control names it. The outline and rings are styled by state in CSS. The body is
 * dimmed apart, so the focus ring stays at full color. */
export const PhraseSymbolIcon = ({ symbol, className }: IPhraseSymbolIconProps) => {
  const half = kButtonSymbolBox / 2;
  const extent = kButtonSymbolExtents[symbol];
  const path = symbolPath(symbol, extent);
  // Centered on the middle of its height, not its centroid, so it lines up with the field
  const top = round(symbolMiddleY(symbol, extent) - half);
  return (
    <svg className={className} width={kButtonSymbolBox} height={kButtonSymbolBox}
      viewBox={`${-half} ${top} ${kButtonSymbolBox} ${kButtonSymbolBox}`} aria-hidden="true"
      data-symbol={symbol} data-testid="phrase-symbol">
      <path className="symbol-selection-edge" d={path} />
      <path className="symbol-selection-ring" d={path} />
      <g className="symbol-body" data-testid="phrase-symbol-body">
        <path className="symbol-outline" d={path} />
        <path className="symbol-fill" d={path} fill={kTestPhraseColor} data-testid="phrase-symbol-path" />
      </g>
      <SymbolFocusRing symbol={symbol} extent={extent} />
    </svg>
  );
};
