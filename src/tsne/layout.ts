// Turns t-SNE coordinates into positions in the unit square, and those into pixels in the graph.

export interface IPosition {
  x: number;
  y: number;
}

export interface ISize {
  width: number;
  height: number;
}

// Space between the graph's edge and the nearest point's center, so no 12px point is clipped
export const kGraphPadding = 12;

/**
 * Scales and moves 2D t-SNE coordinates into [0, 1] × [0, 1]. Both axes use the same scale, so the
 * layout keeps its shape; the shorter side is centered. If every point is in the same place, they
 * all go to the center.
 */
export const normalizeLayout = (solution: readonly (readonly number[])[]): IPosition[] => {
  if (solution.length === 0) return [];
  // A loop, not Math.min(...xs), which fails past the engine's limit on function arguments
  let [minX, maxX, minY, maxY] = [Infinity, -Infinity, Infinity, -Infinity];
  solution.forEach(([x, y]) => {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  });
  const range = Math.max(maxX - minX, maxY - minY);
  if (range === 0) return solution.map(() => ({ x: 0.5, y: 0.5 }));
  // Offsets that center the shorter side
  const offsetX = (1 - (maxX - minX) / range) / 2;
  const offsetY = (1 - (maxY - minY) / range) / 2;
  return solution.map(([x, y]) => ({ x: offsetX + (x - minX) / range, y: offsetY + (y - minY) / range }));
};

/**
 * Maps a position in the unit square to pixels in a graph of the given size, inside the padding.
 * Each axis fills its own side, so a graph that is not square stretches the layout. y = 1 is at
 * the top.
 */
export const toPixels = ({ x, y }: IPosition, { width, height }: ISize, padding = kGraphPadding): IPosition => {
  // A graph smaller than twice the padding puts every point on its center line
  const innerWidth = Math.max(0, width - 2 * padding);
  const innerHeight = Math.max(0, height - 2 * padding);
  return {
    x: innerWidth > 0 ? padding + x * innerWidth : width / 2,
    y: innerHeight > 0 ? padding + (1 - y) * innerHeight : height / 2
  };
};
