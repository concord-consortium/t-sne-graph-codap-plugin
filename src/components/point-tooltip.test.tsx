import React from "react";
import { render, screen } from "@testing-library/react";
import { ISize } from "../tsne/layout";
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
    rerender(<PointTooltip {...props} area={{ width: 200, height: 300 }} />);
    expect(tooltip().style.maxWidth).toBe("192px");
    rerender(<PointTooltip {...props} area={{ width: 6, height: 300 }} />);
    expect(tooltip().style.maxWidth).toBe("0");
  });

  it("places itself from its measured size, right of the point with the pointer on its left", () => {
    render(<PointTooltip {...props} />);
    expect(tooltip().style.left).toBe("110px");
    expect(tooltip().style.top).toBe("138px");
    expect(tooltip()).toHaveAttribute("data-side", "right");
    expect(tooltip().style.getPropertyValue("--pointer-offset")).toBe("0px");
    expect(tooltip().style.visibility).toBe("");
    expect(screen.getByTestId("point-tooltip-pointer")).toBeInTheDocument();
  });

  it("uses the measured width, not the estimate, to choose a side", () => {
    // "Hi" is estimated at 28px, which would fit on the right
    render(<PointTooltip {...props} text="Hi" anchor={{ x: 210, y: 150 }} />);
    expect(tooltip()).toHaveAttribute("data-side", "left");
    expect(tooltip().style.left).toBe(`${210 - 10 - 86}px`);
  });

  it("puts the pointer on the right near the area's right edge", () => {
    render(<PointTooltip {...props} anchor={{ x: 250, y: 150 }} />);
    expect(tooltip()).toHaveAttribute("data-side", "left");
  });

  it("slides the pointer when the box is clamped at the top", () => {
    render(<PointTooltip {...props} anchor={{ x: 100, y: 14 }} />);
    expect(tooltip().style.top).toBe("4px");
    expect(tooltip().style.getPropertyValue("--pointer-offset")).toBe("-2px");
  });

  it("re-places itself on a new anchor", () => {
    const { rerender } = render(<PointTooltip {...props} />);
    rerender(<PointTooltip {...props} anchor={{ x: 40, y: 60 }} />);
    expect(tooltip().style.left).toBe("50px");
    expect(tooltip().style.top).toBe("48px");
  });

  it("measures itself again for new text", () => {
    const { rerender } = render(<PointTooltip {...props} />);
    // Two lines
    mockSize({ width: 240, height: 40 });
    rerender(<PointTooltip {...props} text={"word ".repeat(60)} />);
    expect(tooltip().style.top).toBe("130px");
  });
});
