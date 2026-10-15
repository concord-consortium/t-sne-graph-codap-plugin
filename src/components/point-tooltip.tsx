import React, { CSSProperties, useLayoutEffect, useRef, useState } from "react";
import { IPosition, ISize, kTooltipMargin, placeTooltip, pointerShapes, tooltipMaxWidth } from "../tsne/layout";
import "./point-tooltip.scss";

// The other tooltip sizes are in _variables.scss
export const kTooltipMaxWidth = 240;

const toPoints = (corners: IPosition[]) => corners.map(({ x, y }) => `${x.toFixed(2)},${y.toFixed(2)}`).join(" ");

interface IMeasure extends ISize {
  text: string;
  maxWidth: number;
}

interface IProps {
  text: string;
  color: string;
  fill: string;
  // The point's center and how far its symbol reaches from it, in `area`'s pixels
  anchor: IPosition;
  halfExtent: number;
  area: ISize;
}

/** The phrase beside a point, in the point's colors. Measures itself at the full max width, narrows itself
 * if it fits on neither side of the point, then places itself in `area`. */
export const PointTooltip = ({ text, color, fill, anchor, halfExtent, area }: IProps) => {
  const ref = useRef<HTMLDivElement>(null);
  // At the full max width, so a pan or a resize can narrow it again without measuring
  const [full, setFull] = useState<IMeasure>();
  const [measured, setMeasured] = useState<IMeasure>();
  // CSS ignores a negative max-width
  const fullMaxWidth = Math.max(0, Math.min(kTooltipMaxWidth, area.width - 2 * kTooltipMargin));
  const fullWidth = full?.text === text && full.maxWidth === fullMaxWidth ? full.width : undefined;
  const maxWidth = fullWidth === undefined
    ? fullMaxWidth : tooltipMaxWidth(anchor, halfExtent, fullWidth, fullMaxWidth, area);
  const size = measured?.text === text && measured.maxWidth === maxWidth ? measured : undefined;

  // Before it paints: once at the full max width, then again if that narrows it
  useLayoutEffect(() => {
    if (!ref.current) return;
    const { width, height } = ref.current.getBoundingClientRect();
    const measure = { text, maxWidth, width, height };
    if (fullWidth === undefined) setFull(measure);
    setMeasured(measure);
  }, [text, maxWidth, fullWidth]);

  // Hidden at the area's corner until measured: its size doesn't depend on where it is
  const placement = size && placeTooltip(anchor, halfExtent, size, area);
  const pointer = pointerShapes(placement ?? { pointerOffset: 0, tipOffset: 0 });
  const style = {
    "--tooltip-color": color,
    "--tooltip-fill": fill,
    left: placement?.left ?? 0,
    maxWidth,
    top: placement?.top ?? 0,
    visibility: placement ? undefined : "hidden"
  } as CSSProperties;

  return (
    <div ref={ref} className="point-tooltip" data-side={placement?.side ?? "right"} data-testid="point-tooltip"
      aria-hidden="true" style={style}>
      <svg className="point-tooltip-pointer" data-testid="point-tooltip-pointer" width={1} height={1}>
        <polygon className="point-tooltip-pointer-outline" data-testid="pointer-outline"
          points={toPoints(pointer.outline)} />
        <polygon className="point-tooltip-pointer-border" data-testid="pointer-border"
          points={toPoints(pointer.border)} />
        <polygon className="point-tooltip-pointer-fill" points={toPoints(pointer.fill)} />
      </svg>
      <span className="point-tooltip-text" data-testid="point-tooltip-text">{text}</span>
    </div>
  );
};
