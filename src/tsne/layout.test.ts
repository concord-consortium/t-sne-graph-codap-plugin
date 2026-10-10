import {
  applyTransform, directionToPixels, fitLayout, kGraphPadding, kMinNeighborOffsetPx, normalizeLayout,
  offsetFromNeighbor, paddedBounds, toPixels, unitDirection
} from "./layout";

describe("normalizeLayout", () => {
  it("fits the longer side to [0, 1] and centers the shorter side", () => {
    // 40 wide, 10 tall: y spans 0.25, centered
    expect(normalizeLayout([[-20, 0], [20, 10], [0, 5]])).toEqual([
      { x: 0, y: 0.375 }, { x: 1, y: 0.625 }, { x: 0.5, y: 0.5 }
    ]);
  });

  it("keeps the layout's shape", () => {
    const [a, b, c] = normalizeLayout([[0, 0], [3, 0], [0, 4]]);
    // A 3-4-5 triangle keeps its ratios
    expect(Math.hypot(b.x - a.x, b.y - a.y) / Math.hypot(c.x - a.x, c.y - a.y)).toBeCloseTo(3 / 4, 12);
    expect(Math.hypot(c.x - b.x, c.y - b.y) / Math.hypot(c.x - a.x, c.y - a.y)).toBeCloseTo(5 / 4, 12);
  });

  it("keeps every position in the unit square", () => {
    const layout = normalizeLayout([[-312.5, 77], [14, -90.25], [401, 3], [0, 0], [-5, 250]]);
    layout.forEach(({ x, y }) => {
      [x, y].forEach(value => {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
      });
    });
  });

  it("puts points that are all in one place at the center", () => {
    expect(normalizeLayout([[3, 3], [3, 3]])).toEqual([{ x: 0.5, y: 0.5 }, { x: 0.5, y: 0.5 }]);
    expect(normalizeLayout([[7, -2]])).toEqual([{ x: 0.5, y: 0.5 }]);
  });

  it("handles no points", () => {
    expect(normalizeLayout([])).toEqual([]);
  });

  it("handles more points than a function call can take as arguments", () => {
    const solution = Array.from({ length: 200000 }, (_value, i) => [i, -i]);
    const layout = normalizeLayout(solution);
    expect(layout[0]).toEqual({ x: 0, y: 1 });
    expect(layout[solution.length - 1]).toEqual({ x: 1, y: 0 });
  });
});

describe("toPixels", () => {
  const size = { width: 300, height: 300 };

  it("maps the corners to the padded corners, with y = 1 at the top", () => {
    expect(kGraphPadding).toBe(12);
    expect(toPixels({ x: 0, y: 0 }, size)).toEqual({ x: 12, y: 288 });
    expect(toPixels({ x: 1, y: 1 }, size)).toEqual({ x: 288, y: 12 });
    expect(toPixels({ x: 0.5, y: 0.5 }, size)).toEqual({ x: 150, y: 150 });
  });

  it("fills each side of a size that is not square", () => {
    expect(toPixels({ x: 1, y: 0 }, { width: 500, height: 300 })).toEqual({ x: 488, y: 288 });
  });

  it("uses the padding it is given", () => {
    expect(toPixels({ x: 0, y: 1 }, size, 0)).toEqual({ x: 0, y: 0 });
  });

  it("puts every point on the center line of a side too small for the padding", () => {
    expect(toPixels({ x: 0, y: 1 }, { width: 20, height: 10 })).toEqual({ x: 10, y: 5 });
  });
});

describe("fitLayout", () => {
  const solution = [[-312.5, 77], [14, -90.25], [401, 3], [0, 0], [-5, 250]];

  it("returns the same positions as normalizeLayout", () => {
    expect(fitLayout(solution).positions).toEqual(normalizeLayout(solution));
  });

  it("returns a transform that maps each raw point to its position", () => {
    const { positions, transform } = fitLayout(solution);
    solution.forEach((point, i) => expect(applyTransform(transform, point)).toEqual(positions[i]));
  });

  it("returns the transform's values", () => {
    // 40 wide, 10 tall: y is centered
    expect(fitLayout([[-20, 0], [20, 10]]).transform)
      .toEqual({ minX: -20, minY: 0, range: 40, offsetX: 0, offsetY: 0.375 });
  });

  it("returns a transform that sends everything to the center when all points are in one place", () => {
    const { transform } = fitLayout([[3, 3], [3, 3]]);
    expect(transform.range).toBe(0);
    expect(applyTransform(transform, [100, -7])).toEqual({ x: 0.5, y: 0.5 });
    expect(applyTransform(fitLayout([]).transform, [1, 1])).toEqual({ x: 0.5, y: 0.5 });
  });
});

describe("unitDirection", () => {
  it("scales to unit length", () => {
    expect(unitDirection(3, -4)).toEqual({ dx: 0.6, dy: -0.8 });
  });

  it("gives +x for a zero vector", () => {
    expect(unitDirection(0, 0)).toEqual({ dx: 1, dy: 0 });
  });
});

describe("paddedBounds", () => {
  it("is the area toPixels maps the unit square to", () => {
    expect(paddedBounds({ width: 600, height: 300 })).toEqual({ left: 12, top: 12, right: 588, bottom: 288 });
  });
});

describe("directionToPixels", () => {
  const wide = { width: 600, height: 300 };

  it("flips y", () => {
    expect(directionToPixels({ dx: 0, dy: 1 }, wide)).toEqual({ dx: 0, dy: -1 });
    const { dx, dy } = directionToPixels({ dx: 1, dy: 0 }, wide);
    expect(dx).toBe(1);
    // -0 from the flip
    expect(dy).toBeCloseTo(0, 12);
  });

  it("scales each axis as toPixels does on a plot that is not square", () => {
    const { dx, dy } = directionToPixels({ dx: Math.SQRT1_2, dy: Math.SQRT1_2 }, wide);
    expect(dx).toBeGreaterThan(Math.abs(dy));
    expect(dy).toBeLessThan(0);
    // 576 px wide inside the padding, 276 tall
    expect(dx / -dy).toBeCloseTo(576 / 276, 12);
    expect(Math.hypot(dx, dy)).toBeCloseTo(1, 12);
  });

  it("gives +x for a zero direction", () => {
    expect(directionToPixels({ dx: 0, dy: 0 }, wide)).toEqual({ dx: 1, dy: 0 });
  });
});

describe("offsetFromNeighbor", () => {
  const distance = (a: { x: number, y: number }, b: { x: number, y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
  const inside = ({ x, y }: { x: number, y: number }, bounds: ReturnType<typeof paddedBounds>) =>
    x >= bounds.left && x <= bounds.right && y >= bounds.top && y <= bounds.bottom;
  const right = { dx: 1, dy: 0 };
  const diagonal = { dx: Math.SQRT1_2, dy: Math.SQRT1_2 };

  [{ width: 300, height: 300 }, { width: 200, height: 300 }, { width: 600, height: 300 }].forEach(size => {
    const bounds = paddedBounds(size);
    const center = { x: size.width / 2, y: size.height / 2 };

    describe(`on a ${size.width} x ${size.height} plot`, () => {
      it("moves a point under 10px from its neighbor to exactly 10px along the direction", () => {
        const result = offsetFromNeighbor(center, { x: center.x + 1, y: center.y }, diagonal, bounds);
        expect(distance(result, center)).toBeCloseTo(kMinNeighborOffsetPx, 12);
        expect(result.x - center.x).toBeCloseTo(10 * Math.SQRT1_2, 12);
        expect(result.y - center.y).toBeCloseTo(10 * Math.SQRT1_2, 12);
      });

      it("moves a point on top of its neighbor", () => {
        expect(offsetFromNeighbor(center, center, right, bounds)).toEqual({ x: center.x + 10, y: center.y });
      });

      it("leaves a point that is inside and already far enough", () => {
        const point = { x: center.x + 30, y: center.y - 20 };
        expect(offsetFromNeighbor(center, point, right, bounds)).toEqual(point);
      });

      it("clamps in a point that is outside but more than 10px away", () => {
        const neighbor = { x: bounds.right - 40, y: bounds.top + 40 };
        const result = offsetFromNeighbor(neighbor, { x: bounds.right + 15, y: bounds.top - 5 }, right, bounds);
        expect(result).toEqual({ x: bounds.right, y: bounds.top });
      });

      it("flips the direction inward near each edge and corner", () => {
        const corners = [
          { x: bounds.left + 2, y: bounds.top + 2 }, { x: bounds.right - 2, y: bounds.top + 2 },
          { x: bounds.left + 2, y: bounds.bottom - 2 }, { x: bounds.right - 2, y: bounds.bottom - 2 }
        ];
        const edges = [
          { x: bounds.left, y: center.y }, { x: bounds.right, y: center.y },
          { x: center.x, y: bounds.top }, { x: center.x, y: bounds.bottom }
        ];
        const directions = [right, { dx: -1, dy: 0 }, { dx: 0, dy: 1 }, { dx: 0, dy: -1 }, diagonal,
          { dx: -Math.SQRT1_2, dy: -Math.SQRT1_2 }, { dx: Math.SQRT1_2, dy: -Math.SQRT1_2 }];
        [...corners, ...edges].forEach(neighbor => directions.forEach(direction => {
          const result = offsetFromNeighbor(neighbor, neighbor, direction, bounds);
          expect(inside(result, bounds)).toBe(true);
          expect(distance(result, neighbor)).toBeCloseTo(kMinNeighborOffsetPx, 12);
        }));
      });

      it("flips only the component that would leave the area", () => {
        const neighbor = { x: bounds.right - 3, y: center.y };
        const result = offsetFromNeighbor(neighbor, neighbor, diagonal, bounds);
        expect(result.x).toBeCloseTo(neighbor.x - 10 * Math.SQRT1_2, 12);
        expect(result.y).toBeCloseTo(neighbor.y + 10 * Math.SQRT1_2, 12);
      });
    });
  });

  it("stays inside bounds too small to hold the minimum", () => {
    const bounds = { left: 0, top: 0, right: 8, bottom: 8 };
    const result = offsetFromNeighbor({ x: 4, y: 4 }, { x: 4, y: 4 }, right, bounds);
    expect(inside(result, bounds)).toBe(true);
  });
});
