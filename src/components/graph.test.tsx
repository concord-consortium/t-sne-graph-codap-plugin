import React from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CaseInfo, IPluginStore, Point, PluginStore } from "../models/plugin-store";
import { StoreProvider } from "../models/store-context";
import { clearCodapSelection, selectInCodap } from "../models/selection-sync";
import { kLabelColors, kUnlabeledColor } from "../tsne/labels";
import { Graph, kErrorMessage, kTooFewMessage } from "./graph";

jest.mock("../models/selection-sync", () => ({ clearCodapSelection: jest.fn(), selectInCodap: jest.fn() }));

const kCases: CaseInfo[] = [
  { caseId: "1", values: { phrase: "the cat sat", label: "Similar" } },
  { caseId: "2", values: { phrase: "a dog ran", label: "Opposite" } },
  { caseId: "3", values: { phrase: "the bird sang", label: "Similar" } },
  { caseId: "4", values: { phrase: "a fish swam", label: "" } }
];
const kPoints: Point[] = [
  { caseId: "1", x: 0, y: 0 }, { caseId: "2", x: 1, y: 1 }, { caseId: "3", x: 0.5, y: 0.5 }, { caseId: "4", x: 1, y: 0 }
];
const kPhrases = ["the cat sat", "a dog ran", "the bird sang", "a fish swam"];

type ResizeCallback = (entries: { contentRect: { width: number, height: number } }[]) => void;
interface ResizeGlobal { ResizeObserver?: unknown }

const graphStore = () => {
  const store = PluginStore.create({ dataContextName: "Phrases", phraseAttributeName: "phrase",
    labelAttributeName: "label", tsneSeed: 1 });
  store.setCases(kCases);
  store.setPoints(kPoints);
  store.setComputeStatus("done");
  return store;
};

const renderGraph = (store: IPluginStore) => render(<StoreProvider store={store}><Graph /></StoreProvider>);

const plot = () => screen.getByRole("group");
const point = (phrase: string) => screen.getByRole("button", { name: phrase });
const pointNames = () => screen.queryAllByRole("button").map(button => button.getAttribute("aria-label"));

describe("Graph", () => {
  let store: IPluginStore;

  beforeEach(() => {
    jest.mocked(selectInCodap).mockReset();
    jest.mocked(clearCodapSelection).mockReset();
    // jsdom has no layout; the plot reads its size from here until a ResizeObserver reports one
    jest.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
      { width: 300, height: 300, x: 0, y: 0, top: 0, left: 0, right: 300, bottom: 300, toJSON: () => undefined });
    store = graphStore();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("drawing", () => {
    it("draws an 8 × 8 grid of 1px lines, even with no points", () => {
      store.setPoints([]);
      renderGraph(store);
      const lines = screen.getAllByTestId("grid-line");
      expect(lines).toHaveLength(14);
      // Every 37.5px, rounded, on the half pixel
      expect(lines.slice(0, 7).map(line => line.getAttribute("x1")))
        .toEqual(["38.5", "75.5", "113.5", "150.5", "188.5", "225.5", "263.5"]);
      expect(screen.getByTestId("grid")).toHaveAttribute("aria-hidden", "true");
    });

    it("draws one 12px dot per point, in its label's color, inside the 12px padding", () => {
      renderGraph(store);
      expect(pointNames()).toEqual(kPhrases);
      // (0, 0) is the bottom left, inside the padding
      expect(kPhrases.map(phrase => point(phrase).getAttribute("transform")))
        .toEqual(["translate(12 288)", "translate(288 12)", "translate(150 150)", "translate(288 288)"]);
      const dots = kPhrases.map(phrase => within(point(phrase)).getByTestId("dot"));
      expect(dots.map(dot => dot.getAttribute("r"))).toEqual(["6", "6", "6", "6"]);
      expect(dots.map(dot => dot.getAttribute("fill")))
        .toEqual([kLabelColors[0], kLabelColors[1], kLabelColors[0], kUnlabeledColor]);
      // Each point has a 24px click target
      expect(within(point("the cat sat")).getByTestId("hit-area")).toHaveAttribute("r", "12");
    });

    it("gives every point a 1px outline just outside its dot", () => {
      renderGraph(store);
      kPhrases.forEach(phrase =>
        expect(within(point(phrase)).getByTestId("dot-outline")).toHaveAttribute("r", "6.5"));
    });

    it("shows the selection rings and aria-pressed on selected points only", () => {
      store.setSelectedCaseIds(["2"]);
      renderGraph(store);
      expect(point("a dog ran")).toHaveAttribute("aria-pressed", "true");
      expect(point("the cat sat")).toHaveAttribute("aria-pressed", "false");
      // The 2px ring covers 7 to 9px from the center, and the 1px edge 9 to 10px
      expect(within(point("a dog ran")).getByTestId("selection-ring")).toHaveAttribute("r", "8");
      expect(within(point("a dog ran")).getByTestId("selection-edge")).toHaveAttribute("r", "9.5");
      expect(within(point("the cat sat")).queryByTestId("selection-ring")).toBeNull();
      expect(within(point("the cat sat")).queryByTestId("selection-edge")).toBeNull();
    });

    it("updates when the selection or the colors change", () => {
      renderGraph(store);
      act(() => store.setSelectedCaseIds(["1"]));
      expect(point("the cat sat")).toHaveAttribute("aria-pressed", "true");
      act(() => store.setLabelAttribute(undefined));
      expect(within(point("the cat sat")).getByTestId("dot")).toHaveAttribute("fill", kUnlabeledColor);
    });

    it("summarizes the plot in its label", () => {
      renderGraph(store);
      expect(plot()).toHaveAccessibleName("t-SNE plot of 4 phrases in 3 labels");
      act(() => store.setPoints(kPoints.slice(0, 1)));
      expect(plot()).toHaveAccessibleName("t-SNE plot of 1 phrase in 3 labels");
      act(() => store.setPoints([]));
      expect(plot()).toHaveAccessibleName("t-SNE plot");
    });

    it("keeps dot sizes and moves the points when the plot is resized", () => {
      let resize: ResizeCallback | undefined;
      (globalThis as ResizeGlobal).ResizeObserver = jest.fn((callback: ResizeCallback) => {
        resize = callback;
        return { observe: jest.fn(), disconnect: jest.fn() };
      });
      renderGraph(store);
      act(() => resize?.([{ contentRect: { width: 500, height: 200 } }]));
      expect(plot()).toHaveAttribute("width", "500");
      expect(point("a dog ran")).toHaveAttribute("transform", "translate(488 12)");
      expect(within(point("a dog ran")).getByTestId("dot")).toHaveAttribute("r", "6");
      expect(screen.getAllByTestId("grid-line")[0]).toHaveAttribute("x1", "63.5");
      delete (globalThis as ResizeGlobal).ResizeObserver;
    });
  });

  describe("status", () => {
    it.each([
      ["too-few", kTooFewMessage],
      ["error", kErrorMessage],
      ["idle", ""],
      ["computing", ""],
      ["done", ""]
    ] as const)("shows the %s status in a polite live region", (status, message) => {
      store.setComputeStatus(status);
      renderGraph(store);
      expect(screen.getByRole("status")).toHaveAttribute("aria-live", "polite");
      expect(screen.getByRole("status")).toHaveTextContent(message);
    });

    it("uses the interim wording for too few phrases", () => {
      expect(kTooFewMessage).toBe("Add at least 4 phrases to see the plot.");
    });
  });

  describe("mouse", () => {
    it("selects a clicked point in place of the selection", async () => {
      const user = userEvent.setup();
      renderGraph(store);
      await user.click(point("a dog ran"));
      expect(selectInCodap).toHaveBeenCalledWith(store, ["2"], false);
      expect(clearCodapSelection).not.toHaveBeenCalled();
    });

    it("adds a shift-clicked point to the selection", async () => {
      const user = userEvent.setup();
      renderGraph(store);
      await user.keyboard("{Shift>}");
      await user.click(point("a dog ran"));
      expect(selectInCodap).toHaveBeenCalledWith(store, ["2"], true);
    });

    it("clears the selection on a click on empty space, but not on a shift-click", async () => {
      const user = userEvent.setup();
      renderGraph(store);
      await user.keyboard("{Shift>}");
      await user.click(plot());
      expect(clearCodapSelection).not.toHaveBeenCalled();
      await user.keyboard("{/Shift}");
      await user.click(plot());
      expect(clearCodapSelection).toHaveBeenCalledWith(store);
      expect(selectInCodap).not.toHaveBeenCalled();
    });

    it("makes a clicked point the one the arrow keys move from", async () => {
      const user = userEvent.setup();
      renderGraph(store);
      await user.click(point("the bird sang"));
      expect(point("the bird sang")).toHaveAttribute("tabindex", "0");
      await user.keyboard("{ArrowRight}");
      expect(point("a fish swam")).toHaveFocus();
    });
  });

  describe("keyboard", () => {
    it("is one Tab stop: the plot, until a point has been focused, then that point", async () => {
      const user = userEvent.setup();
      renderGraph(store);
      expect(plot()).toHaveAttribute("tabindex", "0");
      expect(kPhrases.map(phrase => point(phrase).getAttribute("tabindex"))).toEqual(["-1", "-1", "-1", "-1"]);

      await user.tab();
      expect(plot()).toHaveFocus();
      await user.keyboard("{ArrowRight}");
      expect(point("the cat sat")).toHaveFocus();
      expect(plot()).toHaveAttribute("tabindex", "-1");
      expect(point("the cat sat")).toHaveAttribute("tabindex", "0");
    });

    it("leaves an empty plot out of the Tab order", () => {
      store.setPoints([]);
      renderGraph(store);
      expect(plot()).toHaveAttribute("tabindex", "-1");
    });

    it("moves to the next point with Right or Down, and to the previous with Left or Up", async () => {
      const user = userEvent.setup();
      renderGraph(store);
      await user.tab();
      await user.keyboard("{ArrowRight}{ArrowDown}");
      expect(point("a dog ran")).toHaveFocus();
      await user.keyboard("{ArrowRight}");
      expect(point("the bird sang")).toHaveFocus();
      await user.keyboard("{ArrowLeft}");
      expect(point("a dog ran")).toHaveFocus();
      await user.keyboard("{ArrowUp}");
      expect(point("the cat sat")).toHaveFocus();
    });

    it("stops at the first and last points", async () => {
      const user = userEvent.setup();
      renderGraph(store);
      await user.tab();
      await user.keyboard("{ArrowRight}{ArrowUp}");
      expect(point("the cat sat")).toHaveFocus();
      await user.keyboard("{End}{ArrowDown}");
      expect(point("a fish swam")).toHaveFocus();
    });

    it("moves to the first point with Home and the last with End", async () => {
      const user = userEvent.setup();
      renderGraph(store);
      await user.tab();
      await user.keyboard("{End}");
      expect(point("a fish swam")).toHaveFocus();
      await user.keyboard("{Home}");
      expect(point("the cat sat")).toHaveFocus();
    });

    it("starts from the last point when Left or Up is pressed on the plot", async () => {
      const user = userEvent.setup();
      renderGraph(store);
      await user.tab();
      await user.keyboard("{ArrowLeft}");
      expect(point("a fish swam")).toHaveFocus();
    });

    it.each(["{Enter}", " "])("selects the focused point with %p, in place of the selection", async key => {
      const user = userEvent.setup();
      renderGraph(store);
      await user.tab();
      await user.keyboard(`{ArrowRight}{ArrowRight}${key}`);
      expect(selectInCodap).toHaveBeenCalledWith(store, ["2"], false);
    });

    it.each(["{Enter}", " "])("adds the focused point to the selection with Shift+%p", async key => {
      const user = userEvent.setup();
      renderGraph(store);
      await user.tab();
      await user.keyboard(`{ArrowRight}{Shift>}${key}{/Shift}`);
      expect(selectInCodap).toHaveBeenCalledWith(store, ["1"], true);
    });

    it("selects nothing when Enter or Space is pressed on the plot itself", async () => {
      const user = userEvent.setup();
      renderGraph(store);
      await user.tab();
      await user.keyboard("{Enter} ");
      expect(selectInCodap).not.toHaveBeenCalled();
    });

    it("clears the selection with Escape, from the plot or from a point", async () => {
      const user = userEvent.setup();
      renderGraph(store);
      await user.tab();
      await user.keyboard("{Escape}{ArrowRight}{Escape}");
      expect(clearCodapSelection).toHaveBeenCalledTimes(2);
    });

    it("keeps the arrow keys and Space from scrolling, and lets other keys through", () => {
      renderGraph(store);
      // fireEvent returns false when the event's default action was prevented
      expect(fireEvent.keyDown(plot(), { key: "ArrowDown" })).toBe(false);
      expect(fireEvent.keyDown(point("the cat sat"), { key: " " })).toBe(false);
      expect(fireEvent.keyDown(plot(), { key: "a" })).toBe(true);
      expect(fireEvent.keyDown(plot(), { key: "Tab" })).toBe(true);
    });
  });

  describe("focus after a recompute", () => {
    const focusPoint = (phrase: string) => act(() => point(phrase).focus());

    it("returns to the plot while it is empty, then to the same case", () => {
      renderGraph(store);
      focusPoint("a dog ran");
      act(() => store.setPoints([]));
      expect(plot()).toHaveFocus();
      act(() => store.setPoints(kPoints.slice().reverse()));
      expect(point("a dog ran")).toHaveFocus();
    });

    it("moves to the first point when the focused case is gone", () => {
      renderGraph(store);
      focusPoint("a dog ran");
      act(() => store.setPoints([]));
      act(() => store.setPoints(kPoints.filter(p => p.caseId !== "2")));
      expect(point("the cat sat")).toHaveFocus();
    });

    it("stays on the point through progress layouts", () => {
      renderGraph(store);
      focusPoint("the bird sang");
      act(() => store.setPoints(kPoints.map(p => ({ ...p, x: 1 - p.x }))));
      expect(point("the bird sang")).toHaveFocus();
    });

    it("doesn't take focus when focus is elsewhere", () => {
      renderGraph(store);
      act(() => store.setPoints([]));
      act(() => store.setPoints(kPoints));
      expect(plot()).not.toHaveFocus();
      kPhrases.forEach(phrase => expect(point(phrase)).not.toHaveFocus());
    });

    it("lets focus leave the plot", async () => {
      const user = userEvent.setup();
      render(<StoreProvider store={store}><Graph /><button>After</button></StoreProvider>);
      focusPoint("a dog ran");
      await user.tab();
      expect(screen.getByRole("button", { name: "After" })).toHaveFocus();
      act(() => store.setPoints(kPoints.slice(1)));
      expect(screen.getByRole("button", { name: "After" })).toHaveFocus();
    });
  });
});
