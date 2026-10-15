import React from "react";
import { render, screen } from "@testing-library/react";
import { ISize, kTooltipTipToBox } from "../tsne/layout";
import { kTooltipMaxWidth, PointTooltip } from "./point-tooltip";

const area = { width: 300, height: 300 };
const props = {
  text: "Each individual across the globe", color: "#5169ff", fill: "#c0cfff",
  anchor: { x: 100, y: 150 }, halfExtent: 6, area
};

// jsdom has no layout
const mockSize = ({ width, height }: ISize) =>
  jest.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
    { width, height, x: 0, y: 0, top: 0, left: 0, right: width, bottom: height, toJSON: () => undefined });

const tooltip = () => screen.getByTestId("point-tooltip");
const left = () => Number.parseFloat(tooltip().style.left);
const reach = kTooltipTipToBox;
// The [x, y] corners of the pointer's colored triangle: tip, top, bottom
const pointerCorners = () => (screen.getByTestId("pointer-border").getAttribute("points") ?? "").split(" ")
  .map(point => point.split(",").map(Number));

describe("PointTooltip", () => {
  beforeEach(() => {
    mockSize({ width: 86, height: 24 });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("shows the text, hidden from screen readers", () => {
    render(<PointTooltip {...props} />);
    expect(tooltip()).toHaveTextContent("Each individual across the globe");
    expect(tooltip()).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByTestId("point-tooltip-text")).toHaveTextContent("Each individual across the globe");
  });

  it("sets the point's colors as custom properties", () => {
    render(<PointTooltip {...props} />);
    expect(tooltip().style.getPropertyValue("--tooltip-color")).toBe("#5169ff");
    expect(tooltip().style.getPropertyValue("--tooltip-fill")).toBe("#c0cfff");
  });

  it("limits the width to 240px, or to the area less 8px when that is smaller, but not below 0", () => {
    const { rerender } = render(<PointTooltip {...props} />);
    expect(tooltip().style.maxWidth).toBe(`${kTooltipMaxWidth}px`);
    // Room for the 86px box on the right
    rerender(<PointTooltip {...props} anchor={{ x: 50, y: 150 }} area={{ width: 200, height: 300 }} />);
    expect(tooltip().style.maxWidth).toBe("192px");
    rerender(<PointTooltip {...props} area={{ width: 6, height: 300 }} />);
    expect(tooltip().style.maxWidth).toBe("0");
  });

  it("places itself from its measured size, right of the point with the pointer on its left", () => {
    render(<PointTooltip {...props} />);
    expect(left()).toBeCloseTo(100 + reach, 6);
    expect(tooltip().style.top).toBe("138px");
    expect(tooltip()).toHaveAttribute("data-side", "right");
    expect(tooltip().style.visibility).toBe("");
    // Tip 10px out from the box, base on its inner edge, both centered
    expect(pointerCorners()).toEqual([[-10, 0], [1.5, -6], [1.5, 6]]);
  });

  it("chooses a side by its measured width", () => {
    // Measured at 86px, too wide for the right
    render(<PointTooltip {...props} text="Hi" anchor={{ x: 210, y: 150 }} />);
    expect(tooltip()).toHaveAttribute("data-side", "left");
    expect(left()).toBeCloseTo(210 - reach - 86, 6);
  });

  it("tilts the pointer to the point when the box is clamped further than the base can slide", () => {
    render(<PointTooltip {...props} anchor={{ x: 100, y: 12 }} />);
    expect(tooltip().style.top).toBe("4px");
    // The box's center is at 16: the base slides 2px up, and the tip tilts to the point, 4px up
    expect(pointerCorners()).toEqual([[-10, -4], [1.5, -8], [1.5, 4]]);
  });

  it("re-places itself on a new anchor", () => {
    const { rerender } = render(<PointTooltip {...props} />);
    rerender(<PointTooltip {...props} anchor={{ x: 40, y: 60 }} />);
    expect(left()).toBeCloseTo(40 + reach, 6);
    expect(tooltip().style.top).toBe("48px");
  });

  describe("over a point with no room for it on either side", () => {
    // 168px on one line; two lines when the max width is less
    beforeEach(() => {
      jest.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
        const width = Math.min(168, Number.parseFloat(this.style.maxWidth));
        const height = width < 168 ? 40 : 24;
        return { width, height, x: 0, y: 0, top: 0, left: 0, right: width, bottom: height, toJSON: () => undefined };
      });
    });

    it("narrows to the room beside the point and keeps the pointer on it", () => {
      render(<PointTooltip {...props} text="No people are left behind" anchor={{ x: 150, y: 150 }} />);
      expect(tooltip().style.maxWidth).toBe("135px");
      expect(tooltip()).toHaveAttribute("data-side", "right");
      expect(left()).toBeCloseTo(150 + reach, 6);
      expect(tooltip().style.top).toBe("130px");
      expect(tooltip().style.visibility).toBe("");
    });

    it("widens again when the point moves to where the box fits", () => {
      const { rerender } = render(<PointTooltip {...props} anchor={{ x: 150, y: 150 }} />);
      rerender(<PointTooltip {...props} anchor={{ x: 100, y: 150 }} />);
      expect(tooltip().style.maxWidth).toBe("240px");
      expect(left()).toBeCloseTo(100 + reach, 6);
      expect(tooltip().style.top).toBe("138px");
    });

    it("stays at the full width when the room is under 80px, so containment wins", () => {
      render(<PointTooltip {...props} anchor={{ x: 75, y: 150 }} area={{ width: 150, height: 300 }} />);
      expect(tooltip().style.maxWidth).toBe("142px");
      expect(tooltip().style.left).toBe("4px");
    });
  });

  it("measures itself again for new text", () => {
    const { rerender } = render(<PointTooltip {...props} />);
    // Two lines
    mockSize({ width: 240, height: 40 });
    rerender(<PointTooltip {...props} text={"word ".repeat(60)} />);
    expect(tooltip().style.top).toBe("130px");
  });
});
