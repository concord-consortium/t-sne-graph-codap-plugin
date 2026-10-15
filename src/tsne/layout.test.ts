import {
  applyTransform, applyView, clampView, directionToPixels, fitLayout, gridLines, IPosition, IView, kFitView,
  kGraphPadding, kMaxZoomLevel, kMinNeighborOffsetPx, kMinZoomLevel, kOffsetCandidates, kTooltipMargin,
  kTooltipMinWidth, kTooltipTipToBox, kZoomFactor, normalizeLayout, offsetFromNeighbor, paddedBounds,
  panToInclude, placeTooltip, pointerShapes, scaleForLevel, toPixels, tooltipMaxWidth, unitDirection, worldBounds
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
      it("moves a point under 18px from its neighbor to exactly 18px along the direction", () => {
        const result = offsetFromNeighbor(center, { x: center.x + 1, y: center.y }, diagonal, bounds);
        expect(distance(result, center)).toBeCloseTo(kMinNeighborOffsetPx, 12);
        expect(result.x - center.x).toBeCloseTo(kMinNeighborOffsetPx * Math.SQRT1_2, 12);
        expect(result.y - center.y).toBeCloseTo(kMinNeighborOffsetPx * Math.SQRT1_2, 12);
      });

      it("moves a point on top of its neighbor", () => {
        expect(offsetFromNeighbor(center, center, right, bounds))
          .toEqual({ x: center.x + kMinNeighborOffsetPx, y: center.y });
      });

      it("leaves a point that is inside and already far enough", () => {
        const point = { x: center.x + 30, y: center.y - 20 };
        expect(offsetFromNeighbor(center, point, right, bounds)).toEqual(point);
      });

      it("clamps in a point that is outside but more than 18px away", () => {
        const neighbor = { x: bounds.right - 40, y: bounds.top + 40 };
        const result = offsetFromNeighbor(neighbor, { x: bounds.right + 15, y: bounds.top - 5 }, right, bounds);
        expect(result).toEqual({ x: bounds.right, y: bounds.top });
      });

      it("stays inside, 18px from the neighbor, near each edge and corner", () => {
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

      it("takes the ring point nearest the direction that is inside the area", () => {
        // Down and to the right of a neighbor 3px from the right edge: straight down (+45°) is the
        // first inside
        const neighbor = { x: bounds.right - 3, y: center.y };
        const result = offsetFromNeighbor(neighbor, neighbor, diagonal, bounds);
        expect(result.x).toBeCloseTo(neighbor.x, 9);
        expect(result.y).toBeCloseTo(neighbor.y + kMinNeighborOffsetPx, 9);
      });
    });
  });

  it("stays inside bounds too small to hold the minimum", () => {
    const bounds = { left: 0, top: 0, right: 8, bottom: 8 };
    const result = offsetFromNeighbor({ x: 4, y: 4 }, { x: 4, y: 4 }, right, bounds);
    expect(inside(result, bounds)).toBe(true);
  });

  describe("keeping clear of other dots", () => {
    const bounds = paddedBounds({ width: 300, height: 300 });
    const neighbor = { x: 150, y: 150 };
    // The ring point `degrees` from +x (y down, so positive turns clockwise on screen)
    const ring = (degrees: number) => ({
      x: neighbor.x + kMinNeighborOffsetPx * Math.cos(degrees * Math.PI / 180),
      y: neighbor.y + kMinNeighborOffsetPx * Math.sin(degrees * Math.PI / 180)
    });
    // The result's angle around the neighbor, in degrees
    const angleOf = ({ x, y }: { x: number, y: number }) =>
      Math.atan2(y - neighbor.y, x - neighbor.x) * 180 / Math.PI;
    const nearestOther = (point: { x: number, y: number }, others: { x: number, y: number }[]) =>
      Math.min(...others.map(other => distance(point, other)));

    it("moves along the direction when no other dot is near", () => {
      const far = [{ x: 30, y: 30 }, { x: 270, y: 270 }];
      expect(angleOf(offsetFromNeighbor(neighbor, neighbor, right, bounds, far))).toBeCloseTo(0, 6);
    });

    it("turns away from a dot on the direction, to the first ring point 18px clear of it", () => {
      const others = [ring(0)];
      const result = offsetFromNeighbor(neighbor, neighbor, right, bounds, others);
      // Ring points are 18px apart at 60°; +60° is visited before −60°
      expect(angleOf(result)).toBeCloseTo(60, 6);
      expect(distance(result, neighbor)).toBeCloseTo(kMinNeighborOffsetPx, 9);
      expect(nearestOther(result, others)).toBeGreaterThanOrEqual(kMinNeighborOffsetPx - 1e-9);
    });

    it("prefers the clear ring point nearest the direction, on either side", () => {
      // A dot at +15°: −45° (60° from it) comes before +75°
      expect(angleOf(offsetFromNeighbor(neighbor, neighbor, right, bounds, [ring(15)]))).toBeCloseTo(-45, 6);
    });

    it("takes the one free ring point when dots sit on all the others", () => {
      const others = Array.from({ length: kOffsetCandidates }, (_value, i) => ring(i * 15))
        .filter((_point, i) => i !== 7);
      // Its neighbors on the ring are 4.7px away, so it isn't clear, but it has the most room
      expect(angleOf(offsetFromNeighbor(neighbor, neighbor, right, bounds, others))).toBeCloseTo(105, 6);
    });

    it("takes the ring point with the most clearance when none is clear", () => {
      // Dots 6px outside every ring point, except 12px outside at 120°
      const others = Array.from({ length: kOffsetCandidates }, (_value, i) => {
        const degrees = i * 15;
        const radius = kMinNeighborOffsetPx + (degrees === 120 ? 12 : 6);
        return { x: neighbor.x + radius * Math.cos(degrees * Math.PI / 180),
          y: neighbor.y + radius * Math.sin(degrees * Math.PI / 180) };
      });
      const result = offsetFromNeighbor(neighbor, neighbor, right, bounds, others);
      expect(inside(result, bounds)).toBe(true);
      expect(distance(result, neighbor)).toBeCloseTo(kMinNeighborOffsetPx, 9);
      expect(angleOf(result)).toBeCloseTo(120, 6);
    });

    it("takes the earliest of two ring points with the same clearance", () => {
      // Dots on every ring point but ±15°, placed in mirror pairs so the two tie exactly
      const others = [0, 180, 30, -30, 45, -45, 60, -60, 75, -75, 90, -90, 105, -105, 120, -120, 135, -135,
        150, -150, 165, -165].map(ring);
      // +15° is visited first
      expect(angleOf(offsetFromNeighbor(neighbor, neighbor, right, bounds, others))).toBeCloseTo(15, 6);
    });

    it("skips ring points outside the area and ring points on other dots, near a corner", () => {
      // Pushed left, out of the bottom-left corner: straight up is the first ring point inside, and a
      // dot sits there, so the search goes on to the first point inside and clear of it, at −30°
      const corner = { x: bounds.left + 4, y: bounds.bottom - 4 };
      const others = [{ x: corner.x, y: corner.y - kMinNeighborOffsetPx }];
      const result = offsetFromNeighbor(corner, corner, { dx: -1, dy: 0 }, bounds, others);
      expect(inside(result, bounds)).toBe(true);
      expect(distance(result, corner)).toBeCloseTo(kMinNeighborOffsetPx, 9);
      expect(nearestOther(result, others)).toBeGreaterThanOrEqual(kMinNeighborOffsetPx - 1e-9);
      expect(Math.atan2(result.y - corner.y, result.x - corner.x) * 180 / Math.PI).toBeCloseTo(-30, 6);
    });

    it("keeps a ring point on an edge, despite float error", () => {
      // Straight up from a neighbor on the left edge: cos(270°) is a hair below 0
      const onEdge = { x: bounds.left, y: bounds.bottom };
      const result = offsetFromNeighbor(onEdge, onEdge, { dx: -1, dy: 0 }, bounds);
      expect(result).toEqual({ x: bounds.left, y: bounds.bottom - kMinNeighborOffsetPx });
    });

    it("stays inside a plot too small for the ring, with other dots", () => {
      const tiny = { left: 0, top: 0, right: 8, bottom: 8 };
      const result = offsetFromNeighbor({ x: 4, y: 4 }, { x: 4, y: 4 }, right, tiny, [{ x: 6, y: 4 }]);
      expect(inside(result, tiny)).toBe(true);
    });

    it("moves a point already far enough from its neighbor but on another dot", () => {
      const point = ring(90);
      const others = [{ x: point.x + 2, y: point.y }];
      const result = offsetFromNeighbor(neighbor, point, right, bounds, others);
      expect(nearestOther(result, others)).toBeGreaterThanOrEqual(kMinNeighborOffsetPx - 1e-9);
      expect(distance(result, neighbor)).toBeCloseTo(kMinNeighborOffsetPx, 9);
    });

    it("leaves a point clear of its neighbor and every other dot", () => {
      const point = { x: 200, y: 120 };
      expect(offsetFromNeighbor(neighbor, point, right, bounds, [{ x: 30, y: 30 }])).toEqual(point);
    });

    it("keeps two test phrases with the same neighbor and direction apart", () => {
      const first = offsetFromNeighbor(neighbor, neighbor, right, bounds);
      const second = offsetFromNeighbor(neighbor, neighbor, right, bounds, [first]);
      expect(distance(second, first)).toBeGreaterThanOrEqual(kMinNeighborOffsetPx - 1e-9);
      expect(distance(second, neighbor)).toBeCloseTo(kMinNeighborOffsetPx, 9);
    });
  });
});

describe("view", () => {
  const square = { width: 300, height: 300 };
  const wide = { width: 600, height: 300 };
  const level1: IView = { zoomLevel: 1, centerX: 0.5, centerY: 0.5 };

  describe("scaleForLevel", () => {
    it("multiplies by the zoom factor per level", () => {
      expect(scaleForLevel(0)).toBe(1);
      expect(scaleForLevel(1)).toBe(kZoomFactor);
      expect(scaleForLevel(-1)).toBeCloseTo(1 / kZoomFactor, 12);
      expect(scaleForLevel(kMaxZoomLevel)).toBeCloseTo(25.63, 2);
    });
  });

  describe("applyView", () => {
    it("is the identity at the fit view", () => {
      [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 0.3, y: 0.85 }].forEach(point => {
        expect(applyView(point, kFitView)).toEqual(point);
      });
    });

    it("spreads points out from the center at level 1", () => {
      expect(applyView({ x: 0.75, y: 0.5 }, level1)).toEqual({ x: 0.875, y: 0.5 });
      expect(applyView({ x: 0.5, y: 0.25 }, level1)).toEqual({ x: 0.5, y: 0.125 });
    });

    it("puts the view's center at the plot's center", () => {
      expect(applyView({ x: 0.2, y: 0.9 }, { zoomLevel: 3, centerX: 0.2, centerY: 0.9 })).toEqual({ x: 0.5, y: 0.5 });
    });
  });

  describe("clampView", () => {
    it("leaves a view in range alone", () => {
      const view = { zoomLevel: 4, centerX: 0.1, centerY: 0.9 };
      expect(clampView(view)).toEqual(view);
    });

    it("limits the level and rounds it to an integer", () => {
      expect(clampView({ ...kFitView, zoomLevel: kMaxZoomLevel + 3 }).zoomLevel).toBe(kMaxZoomLevel);
      expect(clampView({ ...kFitView, zoomLevel: kMinZoomLevel - 3 }).zoomLevel).toBe(kMinZoomLevel);
      expect(clampView({ ...kFitView, zoomLevel: 2.6 }).zoomLevel).toBe(3);
    });

    it("keeps the center in [0, 1]", () => {
      expect(clampView({ zoomLevel: 0, centerX: -0.5, centerY: 1.5 }))
        .toEqual({ zoomLevel: 0, centerX: 0, centerY: 1 });
    });

    it("replaces a value that isn't finite with the fit view's", () => {
      expect(clampView({ zoomLevel: NaN, centerX: Infinity, centerY: NaN })).toEqual(kFitView);
    });
  });

  describe("worldBounds", () => {
    it("equals the padded bounds at the fit view", () => {
      expect(worldBounds(square, kFitView)).toEqual(paddedBounds(square));
      expect(worldBounds(wide, kFitView)).toEqual(paddedBounds(wide));
    });

    it("is 1.5 times as wide at level 1, centered on the plot", () => {
      const fit = paddedBounds(wide);
      const { left, top, right, bottom } = worldBounds(wide, level1);
      expect(right - left).toBeCloseTo(1.5 * (fit.right - fit.left), 9);
      expect(bottom - top).toBeCloseTo(1.5 * (fit.bottom - fit.top), 9);
      expect((left + right) / 2).toBeCloseTo(300, 9);
      expect((top + bottom) / 2).toBeCloseTo(150, 9);
    });
  });

  describe("panToInclude", () => {
    const { left, top, right, bottom } = paddedBounds(square);
    const inner = right - left;
    const zoomed: IView = { zoomLevel: 2, centerX: 0.5, centerY: 0.5 };
    const scale = scaleForLevel(2);
    // Where the view draws a unit-square point
    const drawn = (point: { x: number, y: number }, view: IView) => toPixels(applyView(point, view), square);

    it("leaves the view alone for a pixel in the padded area", () => {
      expect(panToInclude(zoomed, { x: left, y: bottom }, square)).toBe(zoomed);
      expect(panToInclude(zoomed, { x: 150, y: 150 }, square)).toBe(zoomed);
    });

    it("moves the view the least amount for a pixel past the right edge", () => {
      const view = panToInclude(zoomed, { x: right + 30, y: 150 }, square);
      expect(view.zoomLevel).toBe(zoomed.zoomLevel);
      expect(view.centerY).toBe(zoomed.centerY);
      expect(view.centerX).toBeCloseTo(0.5 + 30 / (inner * scale), 12);
    });

    it("moves the view the least amount for a pixel past the top edge", () => {
      const view = panToInclude(zoomed, { x: 150, y: top - 20 }, square);
      expect(view.centerX).toBe(zoomed.centerX);
      expect(view.centerY).toBeCloseTo(0.5 + 20 / (inner * scale), 12);
    });

    it("brings a drawn point to the padded edge", () => {
      const point = { x: 0.05, y: 0.02 };
      const view = panToInclude(zoomed, drawn(point, zoomed), square);
      const after = drawn(point, view);
      expect(after.x).toBeCloseTo(left, 9);
      expect(after.y).toBeCloseTo(bottom, 9);
    });

    it("never moves the center out of [0, 1]", () => {
      const view = panToInclude({ zoomLevel: 1, centerX: 0.98, centerY: 0.02 }, { x: 5000, y: 5000 }, square);
      expect(view.centerX).toBe(1);
      expect(view.centerY).toBe(0);
    });
  });

  describe("gridLines", () => {
    const fitViewLines = (length: number) => [1, 2, 3, 4, 5, 6, 7].map(i => Math.round(i * length / 8) + 0.5);
    const onHalfPixel = (value: number) => value - Math.floor(value) === 0.5;

    it.each([square, wide])("draws seven lines per axis at the fit view on $width x $height", size => {
      const { x, y } = gridLines(size, kFitView);
      expect(x).toEqual(fitViewLines(size.width));
      expect(y).toEqual(fitViewLines(size.height));
    });

    it("draws fewer lines at level 1", () => {
      const { x, y } = gridLines(square, level1);
      expect(x.length).toBeLessThan(7);
      expect(y.length).toBeLessThan(7);
    });

    it("draws lines past the layout's square at level -1", () => {
      const { x, y } = gridLines(square, { ...kFitView, zoomLevel: -1 });
      expect(x.length).toBeGreaterThan(7);
      expect(y.length).toBeGreaterThan(7);
      const { left, right } = worldBounds(square, { ...kFitView, zoomLevel: -1 });
      expect(x.some(position => position < left)).toBe(true);
      expect(x.some(position => position > right)).toBe(true);
    });

    it.each([square, wide])("draws each line where the view draws its place in the data, on $width x $height",
      size => {
        // Zoomed and panned on both axes, so the padding term and the y flip both matter
        const view: IView = { zoomLevel: 2, centerX: 0.4, centerY: 0.3 };
        const inner = { width: size.width - 2 * kGraphPadding, height: size.height - 2 * kGraphPadding };
        // Fit-view line i is at i / 8 of the plot; drawn where the view puts that unit-square point
        const expected = (length: number, toPixel: (i: number) => number) => {
          const lines: number[] = [];
          for (let i = -50; i <= 50; i++) {
            const pixel = Math.round(toPixel(i));
            if (pixel > 0 && pixel < length) lines.push(pixel + 0.5);
          }
          return lines;
        };
        const xs = expected(size.width, i => toPixels(
          applyView({ x: (i * size.width / 8 - kGraphPadding) / inner.width, y: 0.5 }, view), size).x);
        const ys = expected(size.height, i => toPixels(
          applyView({ x: 0.5, y: 1 - (i * size.height / 8 - kGraphPadding) / inner.height }, view), size).y);
        expect(gridLines(size, view)).toEqual({ x: xs, y: ys });
      });

    it("moves the lines with a pan", () => {
      const panned = gridLines(square, { zoomLevel: 0, centerX: 0.6, centerY: 0.5 }).x;
      // 0.1 of the 276px padded width
      expect(panned).toContain(Math.round(37.5 - 27.6) + 0.5);
    });

    it("puts every line strictly inside the plot, on a half pixel", () => {
      [kFitView, level1, { zoomLevel: -1, centerX: 0.1, centerY: 0.9 }, { zoomLevel: 5, centerX: 0.33, centerY: 0.71 }]
        .forEach(view => {
          [square, wide].forEach(size => {
            const { x, y } = gridLines(size, view);
            x.forEach(position => {
              expect(onHalfPixel(position)).toBe(true);
              expect(position).toBeGreaterThan(0);
              expect(position).toBeLessThan(size.width);
            });
            y.forEach(position => {
              expect(onHalfPixel(position)).toBe(true);
              expect(position).toBeGreaterThan(0);
              expect(position).toBeLessThan(size.height);
            });
          });
        });
    });
  });
});

describe("placeTooltip", () => {
  const area = { width: 300, height: 300 };
  const box = { width: 86, height: 24 };
  const dot = 6;
  // Half the diamond's 18.8px plot extent
  const diamond = 9.4;
  // 11px: the pointer's 10px, and its tip 1px short of the point
  const reach = kTooltipTipToBox;

  it("puts the box right of a dot, with the pointer's tip by its center, vertically centered", () => {
    expect(kTooltipTipToBox).toBe(11);
    expect(placeTooltip({ x: 100, y: 150 }, dot, box, area))
      .toEqual({ left: 100 + reach, top: 138, side: "right", pointerOffset: 0, tipOffset: 0 });
  });

  it("keeps the tip 6px inside a larger symbol's edge", () => {
    const { left, side } = placeTooltip({ x: 100, y: 150 }, diamond, box, area);
    expect(side).toBe("right");
    // Tip at 103.4
    expect(left).toBeCloseTo(103.4 + reach, 12);
  });

  it("flips to the left near the right edge, with the tip 6px inside the symbol's left edge", () => {
    const forDot = placeTooltip({ x: 250, y: 150 }, dot, box, area);
    expect(forDot).toEqual({ left: 250 - reach - 86, top: 138, side: "left", pointerOffset: 0, tipOffset: 0 });
    const forDiamond = placeTooltip({ x: 250, y: 150 }, diamond, box, area);
    expect(forDiamond.side).toBe("left");
    // Tip at 246.6
    expect(forDiamond.left + box.width + reach).toBeCloseTo(246.6, 12);
  });

  it("stays on the right while it fits within the margin", () => {
    // Right edge exactly at 300 − 4
    const lastRight = 300 - kTooltipMargin - 86 - reach;
    expect(placeTooltip({ x: lastRight, y: 150 }, dot, box, area).side).toBe("right");
    expect(placeTooltip({ x: lastRight + 0.01, y: 150 }, dot, box, area).side).toBe("left");
  });

  it("clamps at the top and bottom, sliding the pointer by the shift", () => {
    // Centered top would be 2: moved down 2
    expect(placeTooltip({ x: 100, y: 14 }, dot, box, area))
      .toEqual({ left: 100 + reach, top: kTooltipMargin, side: "right", pointerOffset: -2, tipOffset: -2 });
    // Centered top would be 274: moved up 2
    expect(placeTooltip({ x: 100, y: 286 }, dot, box, area))
      .toEqual({ left: 100 + reach, top: 300 - kTooltipMargin - 24, side: "right", pointerOffset: 2, tipOffset: 2 });
  });

  it("keeps the pointer's base off the rounded corners, and tilts the tip the rest of the way to the point", () => {
    // A 24px box: the base slides (24 − 12) / 2 − 4 = 2px either way. A dot on the padded edge needs 4.
    expect(placeTooltip({ x: 100, y: 12 }, dot, box, area)).toMatchObject({ pointerOffset: -2, tipOffset: -4 });
    expect(placeTooltip({ x: 100, y: 0 }, dot, box, area)).toMatchObject({ pointerOffset: -2, tipOffset: -16 });
    // A two-line, 40px box: 10px either way
    const tall = { width: 86, height: 40 };
    expect(placeTooltip({ x: 100, y: 16 }, dot, tall, area)).toMatchObject({ pointerOffset: -8, tipOffset: -8 });
    expect(placeTooltip({ x: 100, y: 12 }, dot, tall, area)).toMatchObject({ pointerOffset: -10, tipOffset: -12 });
    expect(placeTooltip({ x: 100, y: 300 }, dot, tall, area)).toMatchObject({ pointerOffset: 10, tipOffset: 24 });
  });

  it("clamps at the left when flipped in a narrow area", () => {
    const narrow = { width: 120, height: 300 };
    expect(placeTooltip({ x: 40, y: 150 }, dot, { width: 100, height: 24 }, narrow))
      .toEqual({ left: kTooltipMargin, top: 138, side: "left", pointerOffset: 0, tipOffset: 0 });
  });

  it("puts a box as wide as the area minus 8px 4px from both edges", () => {
    const narrow = { width: 120, height: 300 };
    const { left } = placeTooltip({ x: 60, y: 150 }, dot, { width: 112, height: 24 }, narrow);
    expect(left).toBe(kTooltipMargin);
    expect(narrow.width - (left + 112)).toBe(kTooltipMargin);
  });

  it("starts a box too big for the area 4px from its left and top, overflowing the right and bottom", () => {
    const tiny = { width: 80, height: 30 };
    expect(placeTooltip({ x: 40, y: 15 }, dot, { width: 100, height: 40 }, tiny))
      .toEqual({ left: kTooltipMargin, top: kTooltipMargin, side: "left", pointerOffset: -9, tipOffset: -9 });
  });

  it("keeps the box inside when it can't also aim at a central point: containment wins", () => {
    const narrow = { width: 160, height: 300 };
    const wide = { width: 140, height: 24 };
    const { left, side, pointerOffset } = placeTooltip({ x: 80, y: 150 }, dot, wide, narrow);
    expect(side).toBe("left");
    expect(left).toBe(kTooltipMargin);
    expect(left + wide.width).toBeLessThanOrEqual(narrow.width - kTooltipMargin);
    // The pointer stays on the box's right edge; its tip is short of the point by the clamped amount
    const unclampedLeft = 80 - reach - wide.width;
    const tip = left + wide.width + reach;
    expect(tip - 80).toBeCloseTo(left - unclampedLeft, 12);
    expect(pointerOffset).toBe(0);
  });
});

describe("tooltipMaxWidth", () => {
  const area = { width: 300, height: 300 };
  const reach = kTooltipTipToBox;

  it("keeps the max width when the box fits on the right or the left", () => {
    expect(tooltipMaxWidth({ x: 100, y: 150 }, 6, 168, 240, area)).toBe(240);
    expect(tooltipMaxWidth({ x: 250, y: 150 }, 6, 168, 240, area)).toBe(240);
  });

  it("narrows a box that fits on neither side to the room beside the point, so the pointer stays on it", () => {
    // 135px each side of a central dot: 300 − 4 − 150 − 11, and 150 − 11 − 4
    const maxWidth = tooltipMaxWidth({ x: 150, y: 150 }, 6, 168, 240, area);
    expect(maxWidth).toBe(135);
    const { left, side } = placeTooltip({ x: 150, y: 150 }, 6, { width: maxWidth, height: 40 }, area);
    expect(side).toBe("right");
    expect(left).toBe(150 + reach);
  });

  it("uses the roomier side, in whole pixels, less a larger symbol's reach", () => {
    // Right: 300 − 4 − 120 − 11 = 165; left: 120 − 11 − 4 = 105
    expect(tooltipMaxWidth({ x: 120, y: 150 }, 6, 200, 240, area)).toBe(165);
    // A diamond reaches 3.4px further: 131.6
    expect(tooltipMaxWidth({ x: 150, y: 150 }, 9.4, 168, 240, area)).toBe(131);
  });

  it("keeps the max width when the room is under the minimum, so containment wins", () => {
    const small = { width: 150, height: 300 };
    // 60px each side
    expect(tooltipMaxWidth({ x: 75, y: 150 }, 6, 120, 142, small)).toBe(142);
    // Just over the minimum each side narrows
    const x = kTooltipMinWidth + 0.4 + kTooltipMargin + reach;
    expect(tooltipMaxWidth({ x, y: 150 }, 6, 200, 240, { width: 2 * x, height: 300 })).toBe(kTooltipMinWidth);
  });

  it("never widens past the max width", () => {
    // A point past a tiny area's edge has more room than the area
    expect(tooltipMaxWidth({ x: 100, y: 150 }, 6, 86, 0, { width: 6, height: 300 })).toBe(0);
  });
});

describe("pointerShapes", () => {
  // To 2 decimals
  const corners = (points: IPosition[]) => points.map(({ x, y }) => [Number(x.toFixed(2)), Number(y.toFixed(2))]);

  it("draws the spec's pointer: 10px from the box to the tip, a 1.5px border inside, 1px outline out", () => {
    const { outline, border, fill } = pointerShapes({ pointerOffset: 0, tipOffset: 0 });
    expect(corners(border)).toEqual([[-10, 0], [1.5, -6], [1.5, 6]]);
    // 1.5px in from both sides meets 1.5 / sin(atan(6 / 11.5)) = 3.24px in from the tip
    expect(corners(fill)).toEqual([[-6.76, 0], [1.5, -4.31], [1.5, 4.31]]);
    // Pointed: 1px out from both sides meets 2.16px past the tip. Stops at the box's outer edge.
    expect(corners(outline)).toEqual([[-12.16, 0], [0, -6.35], [0, 6.35]]);
  });

  it("slides the base by the pointer offset, and puts the tip at the tip offset", () => {
    expect(corners(pointerShapes({ pointerOffset: 2, tipOffset: 2 }).border)).toEqual([[-10, 2], [1.5, -4], [1.5, 8]]);
    expect(corners(pointerShapes({ pointerOffset: -2, tipOffset: -14 }).border))
      .toEqual([[-10, -14], [1.5, -8], [1.5, 4]]);
  });

  it.each([-14, 14])("keeps the outline pointed past the tip when tilted %ipx", tipOffset => {
    const { outline, border } = pointerShapes({ pointerOffset: 0, tipOffset });
    const [[outlineX]] = corners(outline);
    const [[tipX]] = corners(border);
    expect(outlineX).toBeLessThan(tipX);
    expect(outline).toHaveLength(3);
  });
});
