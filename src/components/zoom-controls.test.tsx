import React from "react";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { IPluginStore, PluginStore } from "../models/plugin-store";
import { StoreProvider } from "../models/store-context";
import { kMaxZoomLevel } from "../tsne/layout";
import { ZoomControls } from "./zoom-controls";

const graphStore = () => {
  const store = PluginStore.create({ dataContextName: "Phrases", phraseAttributeName: "phrase", tsneSeed: 1 });
  store.setPoints([{ caseId: "1", x: 0, y: 0 }, { caseId: "2", x: 1, y: 1 }]);
  return store;
};

const renderControls = (store: IPluginStore) =>
  render(<StoreProvider store={store}><ZoomControls /></StoreProvider>);

const zoomIn = () => screen.getByRole("button", { name: "Zoom in" });
const zoomOut = () => screen.getByRole("button", { name: "Zoom out" });
const fitAll = () => screen.getByRole("button", { name: "Fit all" });
const announcement = () => screen.getByTestId("zoom-announcement");
const disabled = (button: HTMLElement) => button.getAttribute("aria-disabled") === "true";

describe("ZoomControls", () => {
  let store: IPluginStore;

  beforeEach(() => {
    store = graphStore();
  });

  it("has three named buttons in order, each with a matching tooltip", () => {
    renderControls(store);
    expect(screen.getByRole("group", { name: "Zoom" })).toBeInTheDocument();
    expect(screen.getAllByRole("button").map(button => button.getAttribute("aria-label")))
      .toEqual(["Zoom in", "Zoom out", "Fit all"]);
    [zoomIn(), zoomOut(), fitAll()].forEach(button => {
      expect(within(button).getByTitle(button.getAttribute("aria-label") ?? "")).toBeInTheDocument();
    });
  });

  it("disables only fit all at the fit view", () => {
    renderControls(store);
    expect([zoomIn(), zoomOut(), fitAll()].map(disabled)).toEqual([false, false, true]);
  });

  it("enables fit all once the view has changed, including a pan at level 0", () => {
    renderControls(store);
    act(() => store.zoomIn());
    expect(disabled(fitAll())).toBe(false);
    act(() => store.fitAll());
    act(() => store.panTo(0.4, 0.5));
    expect(disabled(fitAll())).toBe(false);
  });

  it("disables zoom in at the largest zoom, and ignores a click on it", async () => {
    const user = userEvent.setup();
    for (let i = 0; i < kMaxZoomLevel; i++) store.zoomIn();
    renderControls(store);
    expect(disabled(zoomIn())).toBe(true);
    await user.click(zoomIn());
    expect(store.view.zoomLevel).toBe(kMaxZoomLevel);
    expect(announcement()).toHaveTextContent("");
  });

  it("disables zoom out at the smallest zoom, and ignores a click on it", async () => {
    const user = userEvent.setup();
    store.zoomOut();
    renderControls(store);
    expect(disabled(zoomOut())).toBe(true);
    await user.click(zoomOut());
    expect(store.view.zoomLevel).toBe(-1);
  });

  it("disables all three with no graph, and keeps them in the Tab order", async () => {
    const user = userEvent.setup();
    store.setPoints([]);
    store.zoomIn();
    renderControls(store);
    expect([zoomIn(), zoomOut(), fitAll()].map(disabled)).toEqual([true, true, true]);
    await user.tab();
    expect(zoomIn()).toHaveFocus();
    await user.click(zoomIn());
    await user.click(fitAll());
    expect(store.view.zoomLevel).toBe(1);
  });

  it("zooms in and out and fits all, announcing the new zoom after each click", async () => {
    const user = userEvent.setup();
    renderControls(store);
    expect(announcement()).toHaveAttribute("aria-live", "polite");
    expect(announcement()).toHaveTextContent("");
    await user.click(zoomIn());
    expect(store.view.zoomLevel).toBe(1);
    expect(announcement()).toHaveTextContent("Zoom 150%");
    await user.click(zoomIn());
    expect(store.view.zoomLevel).toBe(2);
    expect(announcement()).toHaveTextContent("Zoom 225%");
    await user.click(fitAll());
    expect(store.isFitView).toBe(true);
    expect(announcement()).toHaveTextContent("Zoom 100%, whole plot");
    await user.click(zoomOut());
    expect(store.view.zoomLevel).toBe(-1);
    expect(announcement()).toHaveTextContent("Zoom 67%");
  });

  it("leaves out \"whole plot\" at 100% when the view is panned", async () => {
    const user = userEvent.setup();
    store.zoomOut();
    store.panTo(0.4, 0.5);
    renderControls(store);
    await user.click(zoomIn());
    expect(store.view.zoomLevel).toBe(0);
    expect(announcement()).toHaveTextContent(/^Zoom 100%$/);
  });

  describe("a repeated message is a new node, so screen readers hear it again", () => {
    it("after the view is reset elsewhere, as by a Phrase Column change", async () => {
      const user = userEvent.setup();
      renderControls(store);
      await user.click(zoomIn());
      const first = within(announcement()).getByText("Zoom 150%");
      act(() => store.resetView());
      await user.click(zoomIn());
      const second = within(announcement()).getByText("Zoom 150%");
      expect(second).not.toBe(first);
      expect(first).not.toBeInTheDocument();
    });

    it("after a pan between two Fit all clicks", async () => {
      const user = userEvent.setup();
      store.panTo(0.4, 0.5);
      renderControls(store);
      await user.click(fitAll());
      const first = within(announcement()).getByText("Zoom 100%, whole plot");
      act(() => store.panTo(0.3, 0.5));
      await user.click(fitAll());
      expect(within(announcement()).getByText("Zoom 100%, whole plot")).not.toBe(first);
    });
  });

  describe("clears a message the view no longer matches", () => {
    it("after a reset from a table, column or layout change", async () => {
      const user = userEvent.setup();
      renderControls(store);
      await user.click(zoomIn());
      expect(announcement()).toHaveTextContent("Zoom 150%");
      act(() => store.resetView());
      expect(announcement()).toHaveTextContent("");
    });

    it("after a drag, which makes \"whole plot\" untrue", async () => {
      const user = userEvent.setup();
      store.panTo(0.4, 0.5);
      renderControls(store);
      await user.click(fitAll());
      expect(announcement()).toHaveTextContent("Zoom 100%, whole plot");
      act(() => store.panTo(0.3, 0.5));
      expect(announcement()).toHaveTextContent("");
    });

    it("but keeps it while the view is unchanged", async () => {
      const user = userEvent.setup();
      renderControls(store);
      await user.click(zoomIn());
      act(() => store.panTo(store.view.centerX, store.view.centerY));
      expect(announcement()).toHaveTextContent("Zoom 150%");
    });
  });

  it("works from the keyboard", async () => {
    const user = userEvent.setup();
    renderControls(store);
    await user.tab();
    await user.keyboard("{Enter}");
    expect(store.view.zoomLevel).toBe(1);
    await user.tab();
    await user.tab();
    await user.keyboard(" ");
    expect(store.isFitView).toBe(true);
  });

  it("marks hover and press for styling", async () => {
    const user = userEvent.setup();
    renderControls(store);
    await user.hover(zoomIn());
    expect(zoomIn()).toHaveAttribute("data-hovered", "true");
    await user.pointer({ keys: "[MouseLeft>]", target: zoomIn() });
    expect(zoomIn()).toHaveAttribute("data-pressed", "true");
    await user.pointer({ keys: "[/MouseLeft]", target: zoomIn() });
    expect(zoomIn()).not.toHaveAttribute("data-pressed");
  });
});
