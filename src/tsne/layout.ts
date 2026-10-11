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
// from every other dot
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
 * (unit, in pixels), that clears every other dot; in a crowded area, to the one with the most
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
  const outside = (value: number, min: number, max: number) => value < min || value > max;
  const x = neighbor.x + kMinNeighborOffsetPx * direction.dx;
  const y = neighbor.y + kMinNeighborOffsetPx * direction.dy;
  const dx = outside(x, bounds.left, bounds.right) ? -direction.dx : direction.dx;
  const dy = outside(y, bounds.top, bounds.bottom) ? -direction.dy : direction.dy;
  return clampToBounds({
    x: neighbor.x + kMinNeighborOffsetPx * dx,
    y: neighbor.y + kMinNeighborOffsetPx * dy
  }, bounds);
};
