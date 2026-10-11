import React from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CaseInfo, IPluginStore, Point, PluginStore, TestPhrasePoint } from "../models/plugin-store";
import { StoreProvider } from "../models/store-context";
import { clearCodapSelection, selectPoint, selectTestPhrase } from "../models/selection-sync";
import { kLabelColors, kUnlabeledColor } from "../tsne/labels";
import { Graph, kErrorMessage, kKeyboardHelp, kTooFewMessage } from "./graph";

jest.mock("../models/selection-sync",
  () => ({ clearCodapSelection: jest.fn(), selectPoint: jest.fn(), selectTestPhrase: jest.fn() }));

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
// A point's name is its phrase, then its label when there is a Label Column
const point = (phrase: string) =>
  screen.getByRole("button", { name: name => name === phrase || name.startsWith(`${phrase}, `) });
const pointNames = () => screen.queryAllByRole("button").map(button => button.getAttribute("aria-label"));
const pointPhrases = () => pointNames().map(name => name?.split(", ")[0]);

describe("Graph", () => {
  let store: IPluginStore;

  beforeEach(() => {
    jest.mocked(selectPoint).mockReset();
    jest.mocked(clearCodapSelection).mockReset();
    jest.mocked(selectTestPhrase).mockReset();
    // jsdom has no layout
    jest.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
      { width: 300, height: 300, x: 0, y: 0, top: 0, left: 0, right: 300, bottom: 300, toJSON: () => undefined });
    store = graphStore();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    delete (globalThis as ResizeGlobal).ResizeObserver;
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
      expect(pointPhrases()).toEqual(kPhrases);
      // (0, 0) is the bottom left, inside the padding
      expect(kPhrases.map(phrase => point(phrase).getAttribute("transform")))
        .toEqual(["translate(12 288)", "translate(288 12)", "translate(150 150)", "translate(288 288)"]);
      const dots = kPhrases.map(phrase => within(point(phrase)).getByTestId("dot"));
      expect(dots.map(dot => dot.getAttribute("r"))).toEqual(["6", "6", "6", "6"]);
      expect(dots.map(dot => dot.getAttribute("fill")))
        .toEqual([kLabelColors[0], kLabelColors[1], kLabelColors[0], kUnlabeledColor]);
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
      // The ring covers 7–9px from the center; the edge 9–10px
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

    it("draws the active point again on top, out of the reading order", async () => {
      const user = userEvent.setup();
      store.setSelectedCaseIds(["3"]);
      renderGraph(store);
      expect(screen.queryByTestId("active-point")).toBeNull();

      await user.tab();
      await user.keyboard("{ArrowRight}{ArrowRight}{ArrowRight}");
      expect(point("the bird sang")).toHaveFocus();
      const copy = screen.getByTestId("active-point");
      // After every point, so none covers it
      kPhrases.forEach(phrase =>
        expect(point(phrase).compareDocumentPosition(copy)).toBe(Node.DOCUMENT_POSITION_FOLLOWING));
      expect(copy).toHaveAttribute("transform", point("the bird sang").getAttribute("transform"));
      expect(copy).toHaveAttribute("aria-hidden", "true");
      expect(within(copy).getByTestId("selection-ring")).toBeInTheDocument();
      // Still four buttons for assistive technology
      expect(pointPhrases()).toEqual(kPhrases);

      await user.keyboard("{ArrowRight}");
      expect(screen.getByTestId("active-point"))
        .toHaveAttribute("transform", point("a fish swam").getAttribute("transform"));
      expect(within(screen.getByTestId("active-point")).queryByTestId("selection-ring")).toBeNull();
    });

    it("names each point by its phrase and label", () => {
      renderGraph(store);
      expect(pointNames()).toEqual(
        ["the cat sat, Similar", "a dog ran, Opposite", "the bird sang, Similar", "a fish swam, Unlabeled"]);
    });

    it("names each point by its phrase alone when there is no Label Column", () => {
      store.setLabelAttribute(undefined);
      renderGraph(store);
      expect(pointNames()).toEqual(kPhrases);
    });

    it("describes the keys to use while there are points", () => {
      renderGraph(store);
      expect(plot()).toHaveAccessibleDescription(kKeyboardHelp);
      act(() => store.setPoints([]));
      expect(plot()).not.toHaveAccessibleDescription();
    });

    it("summarizes the plot in its label", () => {
      renderGraph(store);
      expect(plot()).toHaveAccessibleName("t-SNE plot of 4 phrases in 3 labels");
      act(() => store.setPoints(kPoints.slice(0, 1)));
      expect(plot()).toHaveAccessibleName("t-SNE plot of 1 phrase in 3 labels");
      act(() => store.setLabelAttribute(undefined));
      expect(plot()).toHaveAccessibleName("t-SNE plot of 1 phrase");
      act(() => store.setPoints([]));
      expect(plot()).toHaveAccessibleName("t-SNE plot");
    });

    describe("when the area is resized", () => {
      let resize: ResizeCallback | undefined;
      beforeEach(() => {
        (globalThis as ResizeGlobal).ResizeObserver = jest.fn((callback: ResizeCallback) => {
          resize = callback;
          return { observe: jest.fn(), disconnect: jest.fn() };
        });
      });
      afterEach(() => {
        delete (globalThis as ResizeGlobal).ResizeObserver;
      });

      it("keeps the plot square, centered across a wide area, with the same dot sizes", () => {
        renderGraph(store);
        act(() => resize?.([{ contentRect: { width: 500, height: 200 } }]));
        expect(plot()).toHaveAttribute("width", "200");
        expect(plot()).toHaveAttribute("height", "200");
        expect(plot()).toHaveStyle({ left: "150px", top: "0px" });
        expect(point("a dog ran")).toHaveAttribute("transform", "translate(188 12)");
        expect(within(point("a dog ran")).getByTestId("dot")).toHaveAttribute("r", "6");
        expect(screen.getAllByTestId("grid-line")[0]).toHaveAttribute("x1", "25.5");
      });

      it("centers the square down a tall area", () => {
        renderGraph(store);
        act(() => resize?.([{ contentRect: { width: 200, height: 500 } }]));
        expect(plot()).toHaveAttribute("width", "200");
        expect(plot()).toHaveStyle({ left: "0px", top: "150px" });
      });

      it("keeps the square and its position on whole pixels", () => {
        renderGraph(store);
        act(() => resize?.([{ contentRect: { width: 301.5, height: 250.7 } }]));
        expect(plot()).toHaveAttribute("width", "250");
        expect(plot()).toHaveStyle({ left: "25px", top: "0px" });
      });
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
    it("passes a clicked point to selectPoint", async () => {
      const user = userEvent.setup();
      renderGraph(store);
      await user.click(point("a dog ran"));
      expect(selectPoint).toHaveBeenCalledWith(store, "2", false);
      expect(clearCodapSelection).not.toHaveBeenCalled();
    });

    it("passes a shift-clicked point to selectPoint, extending", async () => {
      const user = userEvent.setup();
      renderGraph(store);
      await user.keyboard("{Shift>}");
      await user.click(point("a dog ran"));
      expect(selectPoint).toHaveBeenCalledWith(store, "2", true);
    });

    it("does nothing on a click in the bands around the plot", async () => {
      const user = userEvent.setup();
      renderGraph(store);
      await user.click(screen.getByTestId("graph-area"));
      expect(clearCodapSelection).not.toHaveBeenCalled();
      expect(selectPoint).not.toHaveBeenCalled();
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
      expect(selectPoint).not.toHaveBeenCalled();
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

    it("draws the points and moves between them in the table's row order, not the layout's", async () => {
    const user = userEvent.setup();
    store.setPoints(kPoints.slice().reverse());
    renderGraph(store);
    expect(pointPhrases()).toEqual(kPhrases);
    await user.tab();
    await user.keyboard("{ArrowRight}");
    expect(point("the cat sat")).toHaveFocus();
    // Sorting the table changes the order, not the positions
    act(() => store.setCases(kCases.slice().reverse()));
    expect(pointPhrases()).toEqual(kPhrases.slice().reverse());
    expect(point("the cat sat")).toHaveAttribute("transform", "translate(12 288)");
    await user.keyboard("{ArrowRight}");
    expect(point("the cat sat")).toHaveFocus();
  });

  it("starts from the last point when Left or Up is pressed on the plot", async () => {
      const user = userEvent.setup();
      renderGraph(store);
      await user.tab();
      await user.keyboard("{ArrowLeft}");
      expect(point("a fish swam")).toHaveFocus();
    });

    it.each(["{Enter}", " "])("passes the focused point to selectPoint with %p", async key => {
      const user = userEvent.setup();
      renderGraph(store);
      await user.tab();
      await user.keyboard(`{ArrowRight}{ArrowRight}${key}`);
      expect(selectPoint).toHaveBeenCalledWith(store, "2", false);
    });

    it.each(["{Enter}", " "])("passes the focused point to selectPoint, extending, with Shift+%p", async key => {
      const user = userEvent.setup();
      renderGraph(store);
      await user.tab();
      await user.keyboard(`{ArrowRight}{Shift>}${key}{/Shift}`);
      expect(selectPoint).toHaveBeenCalledWith(store, "1", true);
    });

    it("selects nothing when Enter or Space is pressed on the plot itself", async () => {
      const user = userEvent.setup();
      renderGraph(store);
      await user.tab();
      await user.keyboard("{Enter} ");
      expect(selectPoint).not.toHaveBeenCalled();
    });

    it("clears the selection with Escape, from the plot or from a point", async () => {
      const user = userEvent.setup();
      renderGraph(store);
      await user.tab();
      await user.keyboard("{Escape}{ArrowRight}{Escape}");
      expect(clearCodapSelection).toHaveBeenCalledTimes(2);
    });

    it("leaves keys pressed with Alt, Ctrl or Meta to the browser", () => {
      renderGraph(store);
      ["altKey", "ctrlKey", "metaKey"].forEach(modifier => {
        expect(fireEvent.keyDown(plot(), { key: "ArrowDown", [modifier]: true })).toBe(true);
        expect(fireEvent.keyDown(plot(), { key: "Escape", [modifier]: true })).toBe(true);
      });
      kPhrases.forEach(phrase => expect(point(phrase)).not.toHaveFocus());
      expect(clearCodapSelection).not.toHaveBeenCalled();
    });

    it("ignores a held Enter or Space, which would select over and over", async () => {
      const user = userEvent.setup();
      renderGraph(store);
      await user.tab();
      await user.keyboard("{ArrowRight}");
      expect(fireEvent.keyDown(point("the cat sat"), { key: "Enter", repeat: true })).toBe(false);
      expect(fireEvent.keyDown(point("the cat sat"), { key: " ", repeat: true, shiftKey: true })).toBe(false);
      expect(selectPoint).not.toHaveBeenCalled();
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

    it("leaves focus on the plot after a click on empty space", async () => {
      const user = userEvent.setup();
      renderGraph(store);
      await user.tab();
      await user.keyboard("{ArrowRight}");
      expect(point("the cat sat")).toHaveFocus();
      await user.click(plot());
      expect(plot()).toHaveFocus();
      // Any re-render, such as CODAP's selection arriving
      act(() => store.setSelectedCaseIds([]));
      expect(plot()).toHaveFocus();
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

  describe("test phrases", () => {
    const testPoint = (slot: number, x: number, y: number, neighborCaseId: string, dx = 1, dy = 0): TestPhrasePoint =>
      ({ slot, x, y, neighborCaseId, direction: { dx, dy } });
    const symbolPoints = () => screen.queryAllByTestId("test-phrase-point");
    const symbolPoint = (name: string) => screen.getByRole("button", { name });
    const symbolCenter = (name: string) => {
      const [, x, y] = /translate\(([\d.]+) ([\d.]+)\)/.exec(symbolPoint(name).getAttribute("transform") ?? "") ?? [];
      return { x: Number(x), y: Number(y) };
    };

    // 300 × 300: case 3 at (150, 150), case 1 at (12, 288)
    beforeEach(() => {
      store.setTestPhrase(0, "the cat");
      store.setTestPhrase(2, "a bird");
      store.setTestPhrase(4, "a fish");
      store.setTestPhrasePoints([
        // On its neighbor
        testPoint(0, 0.5, 0.5, "3"),
        // Far from its neighbor
        testPoint(2, 0.25, 0.75, "3"),
        // On the corner point, pushed outward, so it flips inward
        testPoint(4, 0, 0, "1", -1, 0)
      ], { 0: "placed", 1: "empty", 2: "placed", 3: "empty", 4: "placed" });
    });

    describe("drawing", () => {
      it("draws each placed slot's symbol after the case points, in slot order, named by symbol and phrase", () => {
        renderGraph(store);
        expect(pointNames()).toEqual([
          "the cat sat, Similar", "a dog ran, Opposite", "the bird sang, Similar", "a fish swam, Unlabeled",
          "Square: the cat", "Diamond: a bird", "Star: a fish"
        ]);
        expect(symbolPoints().map(element => element.getAttribute("data-symbol")))
          .toEqual(["square", "diamond", "star"]);
      });

      it("fills each symbol with the test-phrase color, with a white outline and a 24px hit area", () => {
        renderGraph(store);
        const square = symbolPoint("Square: the cat");
        expect(within(square).getByTestId("symbol")).toHaveAttribute("fill", "#2e007f");
        // The spec's 13.3px plot square
        expect(within(square).getByTestId("symbol"))
          .toHaveAttribute("d", "M-6.65 -6.65L6.65 -6.65L6.65 6.65L-6.65 6.65Z");
        expect(within(square).getByTestId("dot-outline")).toHaveStyle({ strokeWidth: "2" });
        expect(within(square).getByTestId("hit-area")).toHaveAttribute("r", "12");
      });

      it("pushes a symbol on its neighbor's dot out to 18px, along its direction", () => {
        renderGraph(store);
        expect(symbolPoint("Square: the cat")).toHaveAttribute("transform", "translate(168 150)");
      });

      it("leaves a symbol far from its neighbor where it was placed", () => {
        renderGraph(store);
        expect(symbolPoint("Diamond: a bird")).toHaveAttribute("transform", "translate(81 81)");
      });

      it("takes the ring point nearest its direction that is inside the plot", () => {
        // Pushed outward from the bottom-left corner: straight up is the first inside
        renderGraph(store);
        const { x, y } = symbolCenter("Star: a fish");
        expect(x).toBeCloseTo(12, 6);
        expect(y).toBeCloseTo(270, 6);
      });

      it("clamps a symbol placed past the edge into the padded area", () => {
        store.setTestPhrasePoints([testPoint(2, 1.2, 0.5, "3")], { 2: "placed" });
        renderGraph(store);
        expect(symbolPoint("Diamond: a bird")).toHaveAttribute("transform", "translate(288 150)");
      });

      it("keeps a symbol clear of another phrase's dot", () => {
        // Placed on case 4, far from its neighbor, case 3
        store.setTestPhrasePoints([testPoint(2, 1, 0, "3")], { 2: "placed" });
        renderGraph(store);
        const { x, y } = symbolCenter("Diamond: a bird");
        expect(Math.hypot(x - 288, y - 288)).toBeGreaterThanOrEqual(18 - 1e-6);
        expect(Math.hypot(x - 150, y - 150)).toBeCloseTo(18, 6);
      });

      it("keeps a higher slot's symbol clear of a lower slot's", () => {
        // Both on case 3, pushed the same way
        store.setTestPhrasePoints([testPoint(0, 0.5, 0.5, "3"), testPoint(2, 0.5, 0.5, "3")],
          { 0: "placed", 2: "placed" });
        renderGraph(store);
        const square = symbolCenter("Square: the cat");
        const diamond = symbolCenter("Diamond: a bird");
        expect(square).toEqual({ x: 168, y: 150 });
        expect(Math.hypot(diamond.x - square.x, diamond.y - square.y)).toBeGreaterThanOrEqual(18 - 1e-6);
        expect(Math.hypot(diamond.x - 150, diamond.y - 150)).toBeCloseTo(18, 6);
      });

      it("keeps the 18px push when the plot is resized", () => {
        let resize: ResizeCallback | undefined;
        (globalThis as ResizeGlobal).ResizeObserver = jest.fn((callback: ResizeCallback) => {
          resize = callback;
          return { observe: jest.fn(), disconnect: jest.fn() };
        });
        renderGraph(store);
        act(() => resize?.([{ contentRect: { width: 600, height: 200 } }]));
        // The plot is a 200px square, so case 3 is at (100, 100)
        expect(symbolPoint("Square: the cat")).toHaveAttribute("transform", "translate(118 100)");
      });

      it("hides the symbol of a slot being edited", () => {
        renderGraph(store);
        act(() => store.setEditingSlot(0));
        expect(pointNames()).not.toContain("Square: the cat");
        act(() => store.setEditingSlot(undefined));
        expect(pointNames()).toContain("Square: the cat");
      });

      it("shows the selection rings in the symbol's shape and aria-pressed on selected slots only", () => {
        store.setSelectedSlots([2]);
        renderGraph(store);
        const diamond = symbolPoint("Diamond: a bird");
        expect(diamond).toHaveAttribute("aria-pressed", "true");
        expect(symbolPoint("Square: the cat")).toHaveAttribute("aria-pressed", "false");
        const path = within(diamond).getByTestId("symbol").getAttribute("d");
        expect(within(diamond).getByTestId("selection-ring")).toHaveAttribute("d", path);
        expect(within(diamond).getByTestId("selection-ring")).toHaveStyle({ strokeWidth: "6" });
        expect(within(diamond).getByTestId("selection-edge")).toHaveStyle({ strokeWidth: "8" });
        expect(within(symbolPoint("Square: the cat")).queryByTestId("selection-ring")).toBeNull();
      });

      it("masks the focus ring to the band 4–6px outside the symbol", () => {
        renderGraph(store);
        const square = symbolPoint("Square: the cat");
        const focusRing = within(square).getByTestId("focus-ring");
        const maskId = focusRing.getAttribute("mask")?.match(/^url\(#(.+)\)$/)?.[1];
        expect(maskId).toBeDefined();
        const mask = within(square).getByTestId("focus-mask");
        expect(mask).toHaveAttribute("id", maskId);
        expect(focusRing).toHaveStyle({ strokeWidth: "12" });
      });

      it("counts the test phrases in the plot's label", () => {
        renderGraph(store);
        expect(plot()).toHaveAccessibleName("t-SNE plot of 4 phrases in 3 labels and 3 test phrases");
        act(() => store.setTestPhrasePoints([testPoint(0, 0.5, 0.5, "3")], { 0: "placed" }));
        expect(plot()).toHaveAccessibleName("t-SNE plot of 4 phrases in 3 labels and 1 test phrase");
        act(() => store.setTestPhrasePoints([], {}));
        expect(plot()).toHaveAccessibleName("t-SNE plot of 4 phrases in 3 labels");
      });
    });

    describe("selecting", () => {
      it("selects a clicked symbol, and adds it with Shift", async () => {
        const user = userEvent.setup();
        renderGraph(store);
        await user.click(symbolPoint("Diamond: a bird"));
        expect(selectTestPhrase).toHaveBeenLastCalledWith(store, 2, false);
        await user.keyboard("{Shift>}");
        await user.click(symbolPoint("Square: the cat"));
        await user.keyboard("{/Shift}");
        expect(selectTestPhrase).toHaveBeenLastCalledWith(store, 0, true);
        expect(selectPoint).not.toHaveBeenCalled();
        expect(clearCodapSelection).not.toHaveBeenCalled();
      });

      it.each(["{Enter}", " "])("selects the focused symbol with %p, and adds it with Shift", async key => {
        const user = userEvent.setup();
        renderGraph(store);
        await user.tab();
        await user.keyboard(`{End}${key}`);
        expect(selectTestPhrase).toHaveBeenLastCalledWith(store, 4, false);
        await user.keyboard(`{Shift>}${key}{/Shift}`);
        expect(selectTestPhrase).toHaveBeenLastCalledWith(store, 4, true);
      });

      it("clears everything with Escape from a symbol", async () => {
        const user = userEvent.setup();
        renderGraph(store);
        await user.tab();
        await user.keyboard("{End}{Escape}");
        expect(clearCodapSelection).toHaveBeenCalledWith(store);
      });
    });

    describe("keyboard order", () => {
      it("moves from the last case point to the symbols, in slot order", async () => {
        const user = userEvent.setup();
        renderGraph(store);
        await user.tab();
        await user.keyboard("{ArrowLeft}");
        expect(symbolPoint("Star: a fish")).toHaveFocus();
        await user.keyboard("{Home}{ArrowRight}{ArrowRight}{ArrowRight}{ArrowRight}");
        expect(symbolPoint("Square: the cat")).toHaveFocus();
        await user.keyboard("{ArrowRight}");
        expect(symbolPoint("Diamond: a bird")).toHaveFocus();
        await user.keyboard("{ArrowLeft}{ArrowLeft}");
        expect(point("a fish swam")).toHaveFocus();
      });

      it("moves focus to the first point when the focused symbol's slot is edited", async () => {
        const user = userEvent.setup();
        renderGraph(store);
        await user.tab();
        await user.keyboard("{End}");
        expect(symbolPoint("Star: a fish")).toHaveFocus();
        act(() => store.setEditingSlot(4));
        expect(point("the cat sat")).toHaveFocus();
      });
    });
  });
});
