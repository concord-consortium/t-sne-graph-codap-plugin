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

/** Fits the layout into the unit square with one scale for both axes, centering the shorter
 * side. Coincident points go to the center. */
export const normalizeLayout = (solution: readonly (readonly number[])[]): IPosition[] => {
  if (solution.length === 0) return [];
  // Not Math.min(...xs): spreading many points can exceed the engine's argument limit
  let [minX, maxX, minY, maxY] = [Infinity, -Infinity, Infinity, -Infinity];
  solution.forEach(([x, y]) => {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  });
  const range = Math.max(maxX - minX, maxY - minY);
  if (range === 0) return solution.map(() => ({ x: 0.5, y: 0.5 }));
  const offsetX = (1 - (maxX - minX) / range) / 2;
  const offsetY = (1 - (maxY - minY) / range) / 2;
  return solution.map(([x, y]) => ({ x: offsetX + (x - minX) / range, y: offsetY + (y - minY) / range }));
};

/** Each axis fills its side, so a non-square graph stretches the layout. y = 1 is at the top. */
export const toPixels = ({ x, y }: IPosition, { width, height }: ISize, padding = kGraphPadding): IPosition => {
  // Too small for the padding: center the points
  const innerWidth = Math.max(0, width - 2 * padding);
  const innerHeight = Math.max(0, height - 2 * padding);
  return {
    x: innerWidth > 0 ? padding + x * innerWidth : width / 2,
    y: innerHeight > 0 ? padding + (1 - y) * innerHeight : height / 2
  };
};
