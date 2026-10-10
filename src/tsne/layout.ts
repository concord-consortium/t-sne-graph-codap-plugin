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

// Keeps a test phrase's symbol beside its neighbor's dot instead of on it
export const kMinNeighborOffsetPx = 10;

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
 * side. Coincident points go to the center. Also returns the transform, for placing new points. */
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

/** Converts a unit-square direction to a unit pixel direction: each axis is scaled as `toPixels`
 * scales it, and y is flipped. */
export const directionToPixels = ({ dx, dy }: IDirection, size: ISize, padding = kGraphPadding): IDirection => {
  const { left, top, right, bottom } = paddedBounds(size, padding);
  return unitDirection(dx * (right - left), -dy * (bottom - top));
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const clampToBounds = ({ x, y }: IPosition, { left, top, right, bottom }: IBounds): IPosition =>
  ({ x: clamp(x, left, right), y: clamp(y, top, bottom) });

/** Clamps the point into the bounds, then moves it to `kMinNeighborOffsetPx` from its neighbor
 * along `direction` (a unit pixel direction) if it is closer. A component that would leave the
 * bounds is flipped. Bounds under 20px across can't hold the minimum; the result is clamped. */
export const offsetFromNeighbor = (
  neighbor: IPosition, point: IPosition, direction: IDirection, bounds: IBounds
): IPosition => {
  const clamped = clampToBounds(point, bounds);
  if (Math.hypot(clamped.x - neighbor.x, clamped.y - neighbor.y) >= kMinNeighborOffsetPx) return clamped;

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
