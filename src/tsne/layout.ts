export interface IPosition {
  x: number;
  y: number;
}

export interface ISize {
  width: number;
  height: number;
}

// Keeps points at the edge from being clipped
export const kGraphPadding = 12;
// A point's click and hover target
export const kHitRadius = 12;

export interface IDirection {
  dx: number;
  dy: number;
}

export interface IBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Maps raw t-SNE coordinates to the unit square. */
export interface ILayoutTransform {
  minX: number;
  minY: number;
  // 0 when every point is in one place
  range: number;
  offsetX: number;
  offsetY: number;
}

// Enough that no plot symbol covers a dot: the ring radius around the neighbor, and the clearance
// from every other dot and lower slot's symbol
export const kMinNeighborOffsetPx = 18;
// Points on that ring, 15° apart
export const kOffsetCandidates = 24;
// So float error in cos and sin can't push a ring point off an edge, or under the minimum
const kTolerance = 1e-9;

/** Unit length; +x for a zero vector. */
export const unitDirection = (dx: number, dy: number): IDirection => {
  const length = Math.hypot(dx, dy);
  return length > 0 ? { dx: dx / length, dy: dy / length } : { dx: 1, dy: 0 };
};

export const applyTransform = (transform: ILayoutTransform, [x, y]: readonly number[]): IPosition => {
  const { minX, minY, range, offsetX, offsetY } = transform;
  if (range === 0) return { x: 0.5, y: 0.5 };
  return { x: offsetX + (x - minX) / range, y: offsetY + (y - minY) / range };
};

/** Fits the layout into the unit square with one scale for both axes, centering the shorter
 * side. Coincident points go to the center. Also returns the transform. */
export const fitLayout = (solution: readonly (readonly number[])[]) => {
  // Not Math.min(...xs): spreading many points can exceed the engine's argument limit
  let [minX, maxX, minY, maxY] = [Infinity, -Infinity, Infinity, -Infinity];
  solution.forEach(([x, y]) => {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  });
  const range = solution.length > 0 ? Math.max(maxX - minX, maxY - minY) : 0;
  const transform: ILayoutTransform = range === 0
    ? { minX: 0, minY: 0, range: 0, offsetX: 0, offsetY: 0 }
    : { minX, minY, range, offsetX: (1 - (maxX - minX) / range) / 2, offsetY: (1 - (maxY - minY) / range) / 2 };
  return { positions: solution.map(point => applyTransform(transform, point)), transform };
};

export const normalizeLayout = (solution: readonly (readonly number[])[]): IPosition[] =>
  fitLayout(solution).positions;

/** Each axis fills its side, so a non-square size stretches the layout. y = 1 is at the top. */
export const toPixels = ({ x, y }: IPosition, { width, height }: ISize, padding = kGraphPadding): IPosition => {
  // Too small for the padding: center the points
  const innerWidth = Math.max(0, width - 2 * padding);
  const innerHeight = Math.max(0, height - 2 * padding);
  return {
    x: innerWidth > 0 ? padding + x * innerWidth : width / 2,
    y: innerHeight > 0 ? padding + (1 - y) * innerHeight : height / 2
  };
};

/** The area `toPixels` maps the unit square to. */
export const paddedBounds = ({ width, height }: ISize, padding = kGraphPadding): IBounds => {
  const topLeft = toPixels({ x: 0, y: 1 }, { width, height }, padding);
  const bottomRight = toPixels({ x: 1, y: 0 }, { width, height }, padding);
  return { left: topLeft.x, top: topLeft.y, right: bottomRight.x, bottom: bottomRight.y };
};

/** Unit pixel direction for a unit-square one: each axis scaled as `toPixels` scales it, y flipped. */
export const directionToPixels = ({ dx, dy }: IDirection, size: ISize, padding = kGraphPadding): IDirection => {
  const { left, top, right, bottom } = paddedBounds(size, padding);
  return unitDirection(dx * (right - left), -dy * (bottom - top));
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const clampToBounds = ({ x, y }: IPosition, { left, top, right, bottom }: IBounds): IPosition =>
  ({ x: clamp(x, left, right), y: clamp(y, top, bottom) });

const distance = (a: IPosition, b: IPosition) => Math.hypot(a.x - b.x, a.y - b.y);

const isInBounds = ({ x, y }: IPosition, { left, top, right, bottom }: IBounds) =>
  x >= left - kTolerance && x <= right + kTolerance && y >= top - kTolerance && y <= bottom + kTolerance;

// Stops at the first dot that is too close
const isClear = (point: IPosition, others: readonly IPosition[]) =>
  others.every(other => distance(point, other) >= kMinNeighborOffsetPx - kTolerance);

const clearance = (point: IPosition, others: readonly IPosition[]) =>
  others.reduce((nearest, other) => Math.min(nearest, distance(point, other)), Infinity);

// The ring around the neighbor inside the bounds, nearest `direction` first: 0°, +15°, −15°, …, 180°
const ringCandidates = (neighbor: IPosition, direction: IDirection, bounds: IBounds) => {
  const start = Math.atan2(direction.dy, direction.dx);
  const step = 2 * Math.PI / kOffsetCandidates;
  const candidates: IPosition[] = [];
  for (let i = 0; i < kOffsetCandidates; i++) {
    const turns = i % 2 === 1 ? (i + 1) / 2 : -i / 2;
    const angle = start + turns * step;
    const candidate = {
      x: neighbor.x + kMinNeighborOffsetPx * Math.cos(angle),
      y: neighbor.y + kMinNeighborOffsetPx * Math.sin(angle)
    };
    if (isInBounds(candidate, bounds)) candidates.push(clampToBounds(candidate, bounds));
  }
  return candidates;
};

/** Clamps the point into the bounds. If it is within `kMinNeighborOffsetPx` of its neighbor or of
 * any of `others`, moves it to the first point on the ring around the neighbor, nearest `direction`
 * (unit, in pixels), that clears all of `others`; in a crowded area, to the one with the most
 * clearance. Bounds under twice the minimum across can't hold the ring. */
export const offsetFromNeighbor = (
  neighbor: IPosition, point: IPosition, direction: IDirection, bounds: IBounds,
  others: readonly IPosition[] = []
): IPosition => {
  const clamped = clampToBounds(point, bounds);
  if (distance(clamped, neighbor) >= kMinNeighborOffsetPx && isClear(clamped, others)) return clamped;

  const candidates = ringCandidates(neighbor, direction, bounds);
  const firstClear = candidates.find(candidate => isClear(candidate, others));
  if (firstClear) return firstClear;
  if (candidates.length > 0) {
    // Crowded: the most clearance, the earliest on a tie
    return candidates.reduce((best, candidate) =>
      clearance(candidate, others) > clearance(best, others) ? candidate : best);
  }

  // A tiny plot: no candidate is inside
  return clampToBounds({
    x: neighbor.x + kMinNeighborOffsetPx * direction.dx,
    y: neighbor.y + kMinNeighborOffsetPx * direction.dy
  }, bounds);
};

export const kZoomFactor = 1.5;
export const kMinZoomLevel = -1;
export const kMaxZoomLevel = 8;

/** `centerX`, `centerY`: the unit-square point at the plot's center. Scale: `kZoomFactor ** zoomLevel`. */
export interface IView {
  zoomLevel: number;
  centerX: number;
  centerY: number;
}

export const kFitView: IView = { zoomLevel: 0, centerX: 0.5, centerY: 0.5 };
export const scaleForLevel = (zoomLevel: number) => kZoomFactor ** zoomLevel;

/** Maps a unit-square point through the view, before `toPixels`. The identity at the fit view. */
export const applyView = ({ x, y }: IPosition, { zoomLevel, centerX, centerY }: IView): IPosition => {
  const scale = scaleForLevel(zoomLevel);
  return { x: 0.5 + (x - centerX) * scale, y: 0.5 + (y - centerY) * scale };
};

const clampOrDefault = (value: number, min: number, max: number, fallback: number) =>
  Number.isFinite(value) ? clamp(value, min, max) : fallback;

/** Integer level in range, center in [0, 1]; a non-finite value becomes the fit view's. */
export const clampView = ({ zoomLevel, centerX, centerY }: IView): IView => ({
  zoomLevel: Math.round(clampOrDefault(zoomLevel, kMinZoomLevel, kMaxZoomLevel, kFitView.zoomLevel)),
  centerX: clampOrDefault(centerX, 0, 1, kFitView.centerX),
  centerY: clampOrDefault(centerY, 0, 1, kFitView.centerY)
});

/** The whole layout's bounds in plot pixels: `paddedBounds` at the fit view, past the plot when zoomed in. */
export const worldBounds = (size: ISize, view: IView, padding = kGraphPadding): IBounds => {
  const topLeft = toPixels(applyView({ x: 0, y: 1 }, view), size, padding);
  const bottomRight = toPixels(applyView({ x: 1, y: 0 }, view), size, padding);
  return { left: topLeft.x, top: topLeft.y, right: bottomRight.x, bottom: bottomRight.y };
};

/** Pans the least amount that brings a pixel into the padded area; returns `view` if none is needed. The
 * center stays in [0, 1], so the pixel may stay outside. */
export const panToInclude = (view: IView, { x, y }: IPosition, size: ISize, padding = kGraphPadding): IView => {
  const { left, top, right, bottom } = paddedBounds(size, padding);
  const shiftX = x < left ? left - x : x > right ? right - x : 0;
  const shiftY = y < top ? top - y : y > bottom ? bottom - y : 0;
  if (shiftX === 0 && shiftY === 0) return view;

  const scale = scaleForLevel(view.zoomLevel);
  const innerWidth = right - left;
  const innerHeight = bottom - top;
  return clampView({
    ...view,
    centerX: innerWidth > 0 ? view.centerX - shiftX / (innerWidth * scale) : view.centerX,
    // y is flipped, as in `toPixels`
    centerY: innerHeight > 0 ? view.centerY + shiftY / (innerHeight * scale) : view.centerY
  });
};

// Per axis, at the fit view
const kGridCells = 8;

// Line i is at i × length / kGridCells at the fit view, moved by the view; on half pixels, so each
// renders as one sharp pixel
const axisGridLines = (length: number, scale: number, offset: number) => {
  const spacing = scale * length / kGridCells;
  if (!(spacing > 0)) return [];
  const first = Math.floor(-offset / spacing);
  const last = Math.ceil((length - offset) / spacing);
  const lines: number[] = [];
  for (let i = first; i <= last; i++) {
    const pixel = Math.round(scale * (i * length / kGridCells) + offset);
    // None on or past an edge
    if (pixel > 0 && pixel < length) lines.push(pixel + 0.5);
  }
  return lines;
};

/** Moves with the dots; seven lines per axis at the fit view. */
export const gridLines = ({ width, height }: ISize, view: IView, padding = kGraphPadding) => {
  const innerWidth = width - 2 * padding;
  const innerHeight = height - 2 * padding;
  // Too small for the padding: `toPixels` centers the points; keep the fit view's grid
  const scale = scaleForLevel(view.zoomLevel);
  const [scaleX, scaleY] = [innerWidth > 0 ? scale : 1, innerHeight > 0 ? scale : 1];
  // y is flipped, as in `toPixels`
  const offsetX = innerWidth > 0 ? padding * (1 - scale) + innerWidth * (0.5 - scale * view.centerX) : 0;
  const offsetY = innerHeight > 0 ? padding * (1 - scale) + innerHeight * (0.5 - scale * (1 - view.centerY)) : 0;
  return { x: axisGridLines(width, scaleX, offsetX), y: axisGridLines(height, scaleY, offsetY) };
};

// Tooltip. The pointer is 11.5 × 12px, its base on the box's inner edge. Its tip goes 6px inside the
// point's edge (a dot's center), less `kTooltipTipGap`.
export const kTooltipMargin = 4;
// Narrower shows too little text, so the box is clamped instead
export const kTooltipMinWidth = 80;
// $tooltip-border-width, $tooltip-radius and the box's white outline in _variables.scss
const kTooltipBorderWidth = 1.5;
const kTooltipRadius = 4;
const kTooltipOutlineWidth = 1;
const kTooltipPointerLength = 11.5;
const kTooltipPointerHalfHeight = 6;
// On a dot of its own color the colored tip can't be seen, and the white outline's tip is 2.16px past it.
// Either looks off center on the point; 1px short looks centered.
const kTooltipTipGap = 1;
// From the point to the box's outer edge
export const kTooltipTipToBox = kTooltipPointerLength - kTooltipBorderWidth + kTooltipTipGap;
const kTooltipTipInset = 6;

export interface ITooltipPlacement {
  left: number;
  top: number;
  side: "right" | "left";
  // Below the box's center: the pointer's base, and its tip (the point's height)
  pointerOffset: number;
  tipOffset: number;
}

// For a box right and left of a point: from the point to the box's near edge, and the room inside the margins
const tooltipRoom = (x: number, halfExtent: number, areaWidth: number) => {
  const reach = Math.max(0, halfExtent - kTooltipTipInset) + kTooltipTipToBox;
  return { reach, right: areaWidth - kTooltipMargin - (x + reach), left: x - reach - kTooltipMargin };
};

/** `maxWidth`, unless a box `width` wide fits on neither side of the point: then the roomier side's room, so
 * the pointer stays on the point, if that is at least `kTooltipMinWidth`. */
export const tooltipMaxWidth = (
  { x }: IPosition, halfExtent: number, width: number, maxWidth: number, area: ISize
) => {
  const { right, left } = tooltipRoom(x, halfExtent, area.width);
  if (width <= right || width <= left) return maxWidth;
  // Down to whole pixels, so a fractionally wider measured box still fits
  const room = Math.floor(Math.max(right, left));
  return room >= kTooltipMinWidth ? Math.min(room, maxWidth) : maxWidth;
};

// A box too big for the area keeps its start margin and overflows the far edge
const clampBox = (start: number, boxLength: number, areaLength: number) =>
  Math.max(kTooltipMargin, Math.min(areaLength - kTooltipMargin - boxLength, start));

/** Right of the point unless that overflows, then left; then clamped inside `area`. After a vertical clamp
 * the pointer's base slides and the pointer tilts, keeping its tip on the point; after a horizontal clamp
 * the tip falls short. */
export const placeTooltip = (
  { x, y }: IPosition, halfExtent: number, { width, height }: ISize, area: ISize
): ITooltipPlacement => {
  const room = tooltipRoom(x, halfExtent, area.width);
  const side = width > room.right ? "left" : "right";
  const left = clampBox(side === "right" ? x + room.reach : x - room.reach - width, width, area.width);
  const top = clampBox(y - height / 2, height, area.height);
  const tipOffset = y - (top + height / 2);
  // Keeps the base off the rounded corners
  const maxOffset = Math.max(0, height / 2 - kTooltipPointerHalfHeight - kTooltipRadius);
  return { left, top, side, pointerOffset: clamp(tipOffset, -maxOffset, maxOffset), tipOffset };
};

// One side of the pointer: a point on it and its direction
interface ILine {
  point: IPosition;
  direction: IPosition;
}

const cross = (a: IPosition, b: IPosition) => a.x * b.y - a.y * b.x;

// `amount` px away from `inside`; negative moves toward it
const offsetLine = (from: IPosition, to: IPosition, inside: IPosition, amount: number): ILine => {
  const direction = { x: to.x - from.x, y: to.y - from.y };
  const length = Math.hypot(direction.x, direction.y);
  const normal = { x: -direction.y / length, y: direction.x / length };
  const sign = normal.x * (inside.x - from.x) + normal.y * (inside.y - from.y) > 0 ? -1 : 1;
  return { point: { x: from.x + sign * amount * normal.x, y: from.y + sign * amount * normal.y }, direction };
};

const intersect = (a: ILine, b: ILine): IPosition => {
  const between = { x: b.point.x - a.point.x, y: b.point.y - a.point.y };
  const t = cross(between, b.direction) / cross(a.direction, b.direction);
  return { x: a.point.x + t * a.direction.x, y: a.point.y + t * a.direction.y };
};

const atX = ({ point, direction }: ILine, x: number): IPosition =>
  ({ x, y: point.y + (x - point.x) * direction.y / direction.x });

// The sides of the triangle `tip`, `top`, `bottom`, moved `amount` out
const offsetSides = (tip: IPosition, top: IPosition, bottom: IPosition, amount: number) => {
  const inside = { x: (tip.x + top.x + bottom.x) / 3, y: (tip.y + top.y + bottom.y) / 3 };
  return [offsetLine(tip, top, inside, amount), offsetLine(tip, bottom, inside, amount)];
};

/** The pointer's corners for a box on the right, from the box's outer left edge and vertical center. The
 * outline stops at the box's edge so it doesn't cross the box's border; the fill covers that border. */
export const pointerShapes = (
  { pointerOffset, tipOffset }: Pick<ITooltipPlacement, "pointerOffset" | "tipOffset">
) => {
  const tip = { x: kTooltipBorderWidth - kTooltipPointerLength, y: tipOffset };
  const top = { x: kTooltipBorderWidth, y: pointerOffset - kTooltipPointerHalfHeight };
  const bottom = { x: kTooltipBorderWidth, y: pointerOffset + kTooltipPointerHalfHeight };
  const [outerTop, outerBottom] = offsetSides(tip, top, bottom, kTooltipOutlineWidth);
  const [innerTop, innerBottom] = offsetSides(tip, top, bottom, -kTooltipBorderWidth);
  return {
    outline: [intersect(outerTop, outerBottom), atX(outerTop, 0), atX(outerBottom, 0)],
    border: [tip, top, bottom],
    fill: [
      intersect(innerTop, innerBottom), atX(innerTop, kTooltipBorderWidth), atX(innerBottom, kTooltipBorderWidth)
    ]
  };
};

/** A hoverable area from the point's target to the box, so a pointer crossing slowly keeps the tooltip. In
 * `pointerShapes`' coordinates: a rectangle from the point's center to the box, as tall as the target and the
 * box, less the target's half on the box's side. Undefined when the box covers the point. */
export const hoverBridge = (
  { x }: IPosition, { left, side, tipOffset }: ITooltipPlacement, { width, height }: ISize
) => {
  const gap = side === "right" ? left - x : x - (left + width);
  if (gap <= 0) return undefined;
  return {
    left: -gap,
    top: Math.min(tipOffset - kHitRadius, -height / 2),
    bottom: Math.max(tipOffset + kHitRadius, height / 2),
    center: { x: -gap, y: tipOffset }
  };
};
