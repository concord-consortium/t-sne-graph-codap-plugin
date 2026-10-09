import { kGraphPadding, normalizeLayout, toPixels } from "./layout";

describe("normalizeLayout", () => {
  it("fits the longer side to [0, 1] and centers the shorter side", () => {
    // 40 wide, 10 tall: x fills [0, 1]; y spans 0.25 and is centered
    expect(normalizeLayout([[-20, 0], [20, 10], [0, 5]])).toEqual([
      { x: 0, y: 0.375 }, { x: 1, y: 0.625 }, { x: 0.5, y: 0.5 }
    ]);
  });

  it("keeps the layout's shape", () => {
    const [a, b, c] = normalizeLayout([[0, 0], [3, 0], [0, 4]]);
    // Distances 3, 4 and 5 keep their ratios
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

  it("fills each side of a graph that is not square", () => {
    expect(toPixels({ x: 1, y: 0 }, { width: 500, height: 300 })).toEqual({ x: 488, y: 288 });
  });

  it("uses the padding it is given", () => {
    expect(toPixels({ x: 0, y: 1 }, size, 0)).toEqual({ x: 0, y: 0 });
  });

  it("puts every point on the center line of a side too small for the padding", () => {
    expect(toPixels({ x: 0, y: 1 }, { width: 20, height: 10 })).toEqual({ x: 10, y: 5 });
  });
});
