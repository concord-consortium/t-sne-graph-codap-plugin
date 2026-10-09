import React from "react";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CaseInfo, IPluginStore, PluginStore } from "../models/plugin-store";
import { StoreProvider } from "../models/store-context";
import { selectInCodap } from "../models/selection-sync";
import { kLabelColors, kUnlabeledColor } from "../tsne/labels";
import { Key } from "./key";

jest.mock("../models/selection-sync", () => ({ selectInCodap: jest.fn() }));

const kCases: CaseInfo[] = [
  { caseId: "1", values: { phrase: "the cat sat", label: "Similar" } },
  { caseId: "2", values: { phrase: "a dog ran", label: "Opposite" } },
  { caseId: "3", values: { phrase: "the bird sang", label: " similar" } },
  { caseId: "4", values: { phrase: "a fish swam", label: "" } }
];

const keyStore = () => {
  const store = PluginStore.create({ dataContextName: "Phrases", phraseAttributeName: "phrase",
    labelAttributeName: "label", tsneSeed: 1 });
  store.setCases(kCases);
  return store;
};

const renderKey = (store: IPluginStore) => render(<StoreProvider store={store}><Key /></StoreProvider>);
const entries = () => within(screen.getByRole("list")).getAllByRole("button");
const entry = (name: RegExp) => screen.getByRole("button", { name });

describe("Key", () => {
  let store: IPluginStore;

  beforeEach(() => {
    jest.mocked(selectInCodap).mockReset();
    store = keyStore();
  });

  it("is a section headed Key, with one button per label in a list", () => {
    renderKey(store);
    expect(screen.getByRole("heading", { name: "Key" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Key" })).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
  });

  it("lists Unlabeled first, then the labels in order of first appearance", () => {
    renderKey(store);
    expect(entries().map(button => button.textContent)).toEqual(["Unlabeled", "Similar", "Opposite"]);
  });

  it("names each entry with its label and its number of points", () => {
    renderKey(store);
    expect(entries().map(button => button.getAttribute("aria-label")))
      .toEqual(["Unlabeled, 1 point", "Similar, 2 points", "Opposite, 1 point"]);
  });

  it("shows each label's color in its dot", () => {
    renderKey(store);
    const dots = entries().map(button => within(button).getByTestId("key-dot"));
    expect(dots[0]).toHaveStyle({ backgroundColor: kUnlabeledColor });
    expect(dots[1]).toHaveStyle({ backgroundColor: kLabelColors[0] });
    expect(dots[2]).toHaveStyle({ backgroundColor: kLabelColors[1] });
  });

  it("marks an entry pressed only when all its points are selected", () => {
    renderKey(store);
    expect(entries().map(button => button.getAttribute("aria-pressed"))).toEqual(["false", "false", "false"]);
    act(() => store.setSelectedCaseIds(["1"]));
    expect(entry(/^Similar/)).toHaveAttribute("aria-pressed", "false");
    act(() => store.setSelectedCaseIds(["1", "3"]));
    expect(entry(/^Similar/)).toHaveAttribute("aria-pressed", "true");
    expect(entry(/^Opposite/)).toHaveAttribute("aria-pressed", "false");
  });

  it("follows a Label Column change", () => {
    renderKey(store);
    act(() => store.setLabelAttribute(undefined));
    expect(entries().map(button => button.getAttribute("aria-label"))).toEqual(["Unlabeled, 4 points"]);
  });

  it("shows only its heading while there are no rows, as in the spec's default state", () => {
    store.setPhraseAttribute(undefined);
    renderKey(store);
    expect(screen.getByRole("region", { name: "Key" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Key" })).toBeInTheDocument();
    expect(screen.queryByRole("list")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
    act(() => store.setPhraseAttribute("phrase"));
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
  });

  it("shows its heading before any table is chosen", () => {
    renderKey(PluginStore.create());
    expect(screen.getByRole("heading", { name: "Key" })).toBeInTheDocument();
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("gives a long label a title with the whole text", () => {
    const long = "a label far too long to fit in the Key column";
    store.setCases([{ caseId: "1", values: { phrase: "x", label: long } }]);
    renderKey(store);
    expect(within(entry(/^a label far/)).getByText(long)).toHaveAttribute("title", long);
  });

  describe("selecting", () => {
    it("selects every point of a clicked label, in place of the selection", async () => {
      const user = userEvent.setup();
      renderKey(store);
      await user.click(entry(/^Similar/));
      expect(selectInCodap).toHaveBeenCalledWith(store, ["1", "3"], false);
    });

    it("selects the Unlabeled points like any other label", async () => {
      const user = userEvent.setup();
      renderKey(store);
      await user.click(entry(/^Unlabeled/));
      expect(selectInCodap).toHaveBeenCalledWith(store, ["4"], false);
    });

    it("adds a shift-clicked label's points to the selection", async () => {
      const user = userEvent.setup();
      renderKey(store);
      await user.keyboard("{Shift>}");
      await user.click(entry(/^Opposite/));
      expect(selectInCodap).toHaveBeenCalledWith(store, ["2"], true);
    });

    it("selects again, rather than unselecting, when a selected entry is clicked", async () => {
      const user = userEvent.setup();
      store.setSelectedCaseIds(["1", "3"]);
      renderKey(store);
      await user.click(entry(/^Similar/));
      expect(selectInCodap).toHaveBeenCalledWith(store, ["1", "3"], false);
    });
  });

  describe("keyboard", () => {
    it("reaches each entry with Tab", async () => {
      const user = userEvent.setup();
      renderKey(store);
      await user.tab();
      expect(entry(/^Unlabeled/)).toHaveFocus();
      await user.tab();
      expect(entry(/^Similar/)).toHaveFocus();
      await user.tab();
      expect(entry(/^Opposite/)).toHaveFocus();
    });

    it.each(["{Enter}", " "])("selects the focused label's points with %p", async key => {
      const user = userEvent.setup();
      renderKey(store);
      await user.tab();
      await user.tab();
      await user.keyboard(key);
      expect(selectInCodap).toHaveBeenCalledWith(store, ["1", "3"], false);
    });

    it.each(["{Enter}", " "])("adds the focused label's points with Shift+%p", async key => {
      const user = userEvent.setup();
      renderKey(store);
      await user.tab();
      await user.keyboard(`{Shift>}${key}{/Shift}`);
      expect(selectInCodap).toHaveBeenCalledWith(store, ["4"], true);
    });
  });
});
