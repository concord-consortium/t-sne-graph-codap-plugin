import React, { CSSProperties, useLayoutEffect, useRef, useState } from "react";
import { IPosition, ISize, kTooltipMargin, placeTooltip } from "../tsne/layout";
import "./point-tooltip.scss";

export const kTooltipMaxWidth = 240;
// Until the box is measured: 8px per character plus the side padding, one line
const kEstimatedCharWidth = 8;
const kTooltipPadding = 12;
const kTooltipHeight = 24;

// The pointer in its own pixels, tip at the origin's x and pointing left; the box's outer left edge is at
// x = 10, its inner edge at 11.5. Each edge has a slope of 6 / 11.5; at 1.5px in from an edge the tip is
// 1.5 / sin(atan(6 / 11.5)) ≈ 3.24px further right. The white outline stops at the box's outer edge, so it
// doesn't cut through the box's border.
const kPointerViewBox = "-3 -1 14.5 14";
const kPointerOutline = "-2.16,6 10,-0.35 10,12.35";
const kPointerBorder = "0,6 11.5,0 11.5,12";
const kPointerFill = "3.24,6 11.5,1.69 11.5,10.31";

interface IProps {
  text: string;
  color: string;
  fill: string;
  // The point's center and how far its symbol reaches from it, in `area`'s pixels
  anchor: IPosition;
  halfExtent: number;
  area: ISize;
}

/** The phrase beside a point, in the point's colors. Measures itself, then places itself in `area`. */
export const PointTooltip = ({ text, color, fill, anchor, halfExtent, area }: IProps) => {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<ISize>();
  // CSS ignores a negative max-width
  const maxWidth = Math.max(0, Math.min(kTooltipMaxWidth, area.width - 2 * kTooltipMargin));

  // Before it paints; only the text and the max width change the size
  useLayoutEffect(() => {
    if (!ref.current) return;
    const { width, height } = ref.current.getBoundingClientRect();
    setSize({ width, height });
  }, [text, maxWidth]);

  const boxSize = size ?? {
    width: Math.min(maxWidth, text.length * kEstimatedCharWidth + kTooltipPadding), height: kTooltipHeight
  };
  const { left, top, side, pointerOffset } = placeTooltip(anchor, halfExtent, boxSize, area);
  const style = {
    "--pointer-offset": `${pointerOffset}px`,
    "--tooltip-color": color,
    "--tooltip-fill": fill,
    left,
    maxWidth,
    top,
    visibility: size ? undefined : "hidden"
  } as CSSProperties;

  return (
    <div ref={ref} className="point-tooltip" data-side={side} data-testid="point-tooltip" aria-hidden="true"
      style={style}>
      <svg className="point-tooltip-pointer" data-testid="point-tooltip-pointer" viewBox={kPointerViewBox}>
        <polygon className="point-tooltip-pointer-outline" points={kPointerOutline} />
        <polygon className="point-tooltip-pointer-border" points={kPointerBorder} />
        <polygon className="point-tooltip-pointer-fill" points={kPointerFill} />
      </svg>
      <span className="point-tooltip-text" data-testid="point-tooltip-text">{text}</span>
    </div>
  );
};
