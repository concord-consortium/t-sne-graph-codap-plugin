import React from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { applySnapshot, getSnapshot } from "mobx-state-tree";
import { CaseInfo, IPluginStore, PlacementStatus, PluginStore, TestPhrasePoint } from "../models/plugin-store";
import { selectTestPhrase } from "../models/selection-sync";
import { StoreProvider } from "../models/store-context";
import { kNoWordsText, TestPhrases } from "./test-phrases";

jest.mock("../models/selection-sync", () => ({ selectTestPhrase: jest.fn() }));

const kCases: CaseInfo[] = [
  { caseId: "1", values: { phrase: "the cat sat" } },
  { caseId: "2", values: { phrase: "a dog ran" } }
];

const point = (slot: number): TestPhrasePoint =>
  ({ slot, x: 0.5, y: 0.5, neighborCaseId: "1", direction: { dx: 1, dy: 0 } });

const readyStore = () => {
  const store = PluginStore.create({ dataContextName: "Phrases", phraseAttributeName: "phrase", tsneSeed: 1 });
  store.setCases(kCases);
  store.setComputeStatus("done");
  return store;
};

// Slot 0 holds "the cat", placed
const placedStore = () => {
  const store = readyStore();
  store.setTestPhrase(0, "the cat");
  store.setTestPhrasePoints([point(0)], { 0: "placed", 1: "empty", 2: "empty", 3: "empty", 4: "empty" });
  return store;
};

const renderTestPhrases = (store: IPluginStore) =>
  render(<StoreProvider store={store}><TestPhrases /></StoreProvider>);
const field = (slot: number) => screen.getByRole("textbox", { name: `Test phrase ${slot + 1}` });
const symbolButtons = () => within(screen.getByRole("list")).getAllByRole("button");

describe("TestPhrases", () => {
  let store: IPluginStore;

  beforeEach(() => {
    jest.mocked(selectTestPhrase).mockReset();
    store = readyStore();
  });

  describe("layout", () => {
    it("is a section headed Test Phrases, with five rows in a list", () => {
      renderTestPhrases(store);
      expect(screen.getByRole("heading", { name: "Test Phrases" })).toBeInTheDocument();
      expect(screen.getByRole("region", { name: "Test Phrases" })).toBeInTheDocument();
      expect(screen.getAllByRole("listitem")).toHaveLength(5);
      expect(screen.getAllByRole("textbox")).toHaveLength(5);
    });

    it("gives each row its symbol, in order, and a placeholder", () => {
      renderTestPhrases(store);
      expect(screen.getAllByTestId("phrase-symbol").map(svg => svg.getAttribute("data-symbol")))
        .toEqual(["square", "triangle", "diamond", "plus", "star"]);
      expect(field(0)).toHaveAttribute("placeholder", "Enter a phrase");
    });

    it("shows the committed phrases", () => {
      store.setTestPhrase(2, "a bird");
      renderTestPhrases(store);
      expect(field(2)).toHaveValue("a bird");
      expect(field(0)).toHaveValue("");
    });

    it("caps a field at 255 characters", () => {
      renderTestPhrases(store);
      expect(field(0)).toHaveAttribute("maxLength", "255");
    });
  });

  describe("committing", () => {
    it("commits on blur, trimmed, and not while typing", async () => {
      renderTestPhrases(store);
      await userEvent.click(field(1));
      await userEvent.keyboard("  a  dog ");
      expect(store.testPhrases[1]).toBe("");
      act(() => field(1).blur());
      expect(store.testPhrases[1]).toBe("a dog");
      expect(field(1)).toHaveValue("a dog");
    });

    it("commits on Tab and moves on", async () => {
      renderTestPhrases(store);
      await userEvent.click(field(1));
      await userEvent.keyboard("a dog");
      await userEvent.tab();
      expect(store.testPhrases[1]).toBe("a dog");
      expect(field(1)).not.toHaveFocus();
    });

    it("commits on Enter and keeps focus in the field", async () => {
      renderTestPhrases(store);
      await userEvent.click(field(1));
      await userEvent.keyboard("a  dog {Enter}");
      expect(store.testPhrases[1]).toBe("a dog");
      expect(field(1)).toHaveFocus();
      expect(field(1)).toHaveValue("a dog");
    });

    it("leaves Enter and Escape to an input method that is composing text", async () => {
      store = placedStore();
      renderTestPhrases(store);
      await userEvent.click(field(0));
      await userEvent.keyboard("{Control>}a{/Control}にほん");
      // IME confirm: most browsers, then Safari
      fireEvent.keyDown(field(0), { key: "Enter", isComposing: true });
      fireEvent.keyDown(field(0), { key: "Enter", keyCode: 229 });
      expect(store.testPhrases[0]).toBe("the cat");
      expect(store.editingSlot).toBe(0);
      // IME cancel
      fireEvent.keyDown(field(0), { key: "Escape", isComposing: true });
      expect(field(0)).toHaveFocus();
      expect(field(0)).toHaveValue("にほん");
      await userEvent.keyboard("{Enter}");
      expect(store.testPhrases[0]).toBe("にほん");
    });

    it("reverts the draft on Escape and leaves the field", async () => {
      store = placedStore();
      renderTestPhrases(store);
      await userEvent.click(field(0));
      await userEvent.keyboard("{Control>}a{/Control}a dog");
      await userEvent.keyboard("{Escape}");
      expect(field(0)).toHaveValue("the cat");
      expect(field(0)).not.toHaveFocus();
      expect(store.testPhrases[0]).toBe("the cat");
      expect(store.testPhrasePoints).toHaveLength(1);
      // Its point shows again
      expect(store.editingSlot).toBeUndefined();
      expect(store.placedSlots.has(0)).toBe(true);
    });

    it("clears a phrase when its text is deleted", async () => {
      store = placedStore();
      renderTestPhrases(store);
      await userEvent.clear(field(0));
      await userEvent.tab();
      expect(store.testPhrases[0]).toBe("");
      expect(store.testPhrasePoints).toEqual([]);
    });

    it("follows phrases restored into the store", () => {
      renderTestPhrases(store);
      act(() => store.setTestPhrase(4, "a fish"));
      expect(field(4)).toHaveValue("a fish");
    });
  });

  describe("editing", () => {
    it("hides a placed phrase's point while its field is focused, and shows it again on commit", async () => {
      store = placedStore();
      renderTestPhrases(store);
      await userEvent.click(field(0));
      expect(store.editingSlot).toBe(0);
      expect(store.placedSlots.has(0)).toBe(false);
      await userEvent.keyboard("{Enter}");
      expect(store.editingSlot).toBeUndefined();
      expect(store.placedSlots.has(0)).toBe(true);
    });

    it("never marks a slot with no committed phrase as edited: it has no point to hide", async () => {
      renderTestPhrases(store);
      await userEvent.click(field(3));
      await userEvent.keyboard("a dog");
      expect(store.editingSlot).toBeUndefined();
    });

    it("marks a slot as edited when typing resumes after Enter commits it", async () => {
      renderTestPhrases(store);
      await userEvent.click(field(3));
      await userEvent.keyboard("a dog{Enter}");
      expect(store.editingSlot).toBeUndefined();
      await userEvent.keyboard("s");
      expect(store.editingSlot).toBe(3);
    });

    it("selects the text when the field is entered with Tab", async () => {
      store = placedStore();
      renderTestPhrases(store);
      await userEvent.tab();
      await userEvent.tab();
      expect(field(0)).toHaveFocus();
      const input = field(0) as HTMLInputElement;
      expect([input.selectionStart, input.selectionEnd]).toEqual([0, "the cat".length]);
    });
  });

  describe("disabled until a Phrase Column is chosen", () => {
    beforeEach(() => {
      store.setPhraseAttribute(undefined);
      store.setTestPhrase(0, "the cat");
    });

    it("marks each field disabled but keeps it in the Tab order", async () => {
      renderTestPhrases(store);
      screen.getAllByRole("listitem").forEach(row => expect(row).toHaveAttribute("data-disabled"));
      expect(field(0)).toHaveAttribute("aria-disabled", "true");
      await userEvent.tab();
      await userEvent.tab();
      expect(field(0)).toHaveFocus();
    });

    it("ignores typing and never marks a slot as edited", async () => {
      renderTestPhrases(store);
      await userEvent.click(field(0));
      await userEvent.keyboard("more");
      await userEvent.tab();
      expect(field(0)).toHaveValue("the cat");
      expect(store.testPhrases[0]).toBe("the cat");
      expect(store.editingSlot).toBeUndefined();
    });

    it("enables the fields once a Phrase Column is chosen and the plot is done", () => {
      renderTestPhrases(store);
      act(() => store.setPhraseAttribute("phrase"));
      expect(field(0)).toHaveAttribute("aria-disabled", "true");
      act(() => store.setComputeStatus("done"));
      expect(field(0)).not.toHaveAttribute("aria-disabled");
    });
  });

  describe("disabled while there is no plot", () => {
    it.each(["idle", "computing", "too-few", "error"] as const)("disables the rows while the plot is %s", status => {
      store.setComputeStatus(status);
      renderTestPhrases(store);
      screen.getAllByRole("listitem").forEach(row => expect(row).toHaveAttribute("data-disabled"));
      expect(field(0)).toHaveAttribute("aria-disabled", "true");
      expect(field(0)).toHaveAttribute("readonly");
    });

    it("keeps a draft typed before the plot went away", async () => {
      renderTestPhrases(store);
      await userEvent.click(field(2));
      await userEvent.keyboard("a bird");
      // A new layout starts, so the rows are disabled until it is done
      act(() => store.setComputeStatus("computing"));
      expect(field(2)).toHaveAttribute("aria-disabled", "true");
      await userEvent.tab();
      expect(store.testPhrases[2]).toBe("a bird");
    });

    it("keeps a draft typed into a placed slot before the plot went away", async () => {
      store = placedStore();
      renderTestPhrases(store);
      await userEvent.click(field(0));
      expect(store.editingSlot).toBe(0);
      await userEvent.keyboard("a dog");
      act(() => store.setComputeStatus("computing"));
      await userEvent.tab();
      expect(store.testPhrases[0]).toBe("a dog");
      expect(store.editingSlot).toBeUndefined();
    });

    it("keeps a phrase restored while its field had focus", async () => {
      // Before the saved state loads, the plugin has no Phrase Column, so the fields are read-only
      store = PluginStore.create();
      renderTestPhrases(store);
      await userEvent.tab();
      await userEvent.tab();
      expect(field(0)).toHaveFocus();
      act(() => applySnapshot(store, { ...getSnapshot(store), testPhrases: ["the cat", "", "", "", ""] }));
      expect(field(0)).toHaveValue("the cat");
      await userEvent.tab();
      expect(store.testPhrases[0]).toBe("the cat");
    });
  });

  describe("symbol buttons", () => {
    it("names each with its symbol and phrase", () => {
      store = placedStore();
      renderTestPhrases(store);
      expect(symbolButtons().map(button => button.getAttribute("aria-label"))).toEqual([
        "Square: the cat, select its point", "Triangle, no phrase", "Diamond, no phrase", "Plus, no phrase",
        "Star, no phrase"
      ]);
    });

    it("says why a phrase has no point", async () => {
      store = placedStore();
      store.setTestPhrase(1, "a dog");
      store.setTestPhrase(2, "zebra");
      store.setTestPhrasePoints([point(0)], { 0: "placed", 2: "no-words", 3: "empty", 4: "empty" });
      renderTestPhrases(store);
      const [square, triangle, diamond] = symbolButtons();
      // Waiting for placement
      expect(triangle).toHaveAttribute("aria-label", "Triangle: a dog, no point yet");
      // The no-words description says why
      expect(diamond).toHaveAttribute("aria-label", "Diamond: zebra, no point");
      await userEvent.click(field(0));
      expect(square).toHaveAttribute("aria-label", "Square: the cat, no point yet");
    });

    it("dims the symbol until its slot is placed, and keeps it full while the slot is edited", async () => {
      store = placedStore();
      store.setTestPhrase(1, "a dog");
      renderTestPhrases(store);
      const [square, triangle] = symbolButtons();
      expect(square).toHaveAttribute("data-placed");
      // Waiting for placement
      expect(triangle).not.toHaveAttribute("data-placed");
      await userEvent.click(field(0));
      expect(square).toHaveAttribute("data-placed");
    });

    it("is disabled without a point: empty, no words, or being edited", async () => {
      store = placedStore();
      store.setTestPhrase(2, "zebra");
      store.setTestPhrasePoints([point(0)], { 0: "placed", 1: "empty", 2: "no-words", 3: "empty", 4: "empty" });
      renderTestPhrases(store);
      const [square, triangle, diamond] = symbolButtons();
      expect(square).not.toHaveAttribute("aria-disabled");
      expect(triangle).toHaveAttribute("aria-disabled", "true");
      expect(diamond).toHaveAttribute("aria-disabled", "true");
      await userEvent.click(field(0));
      expect(square).toHaveAttribute("aria-disabled", "true");
      await userEvent.tab();
      expect(square).not.toHaveAttribute("aria-disabled");
    });

    it("is disabled without a Phrase Column, even with a point", () => {
      store = PluginStore.create({ dataContextName: "Phrases", tsneSeed: 1 });
      store.setTestPhrase(0, "the cat");
      store.setTestPhrasePoints([point(0)], { 0: "placed", 1: "empty", 2: "empty", 3: "empty", 4: "empty" });
      expect(store.placedSlots.has(0)).toBe(true);
      renderTestPhrases(store);
      expect(symbolButtons()[0]).toHaveAttribute("aria-disabled", "true");
    });

    it("keeps a disabled button in the Tab order", async () => {
      renderTestPhrases(store);
      await userEvent.tab();
      expect(symbolButtons()[0]).toHaveFocus();
    });

    it("selects its point on press, and adds it with Shift", async () => {
      store = placedStore();
      renderTestPhrases(store);
      const user = userEvent.setup();
      await user.click(symbolButtons()[0]);
      expect(selectTestPhrase).toHaveBeenLastCalledWith(store, 0, false);
      await user.keyboard("{Shift>}");
      await user.click(symbolButtons()[0]);
      await user.keyboard("{/Shift}");
      expect(selectTestPhrase).toHaveBeenLastCalledWith(store, 0, true);
    });

    it("selects with Enter and Space", async () => {
      store = placedStore();
      renderTestPhrases(store);
      await userEvent.tab();
      await userEvent.keyboard("{Enter}");
      await userEvent.keyboard(" ");
      expect(selectTestPhrase).toHaveBeenCalledTimes(2);
      expect(selectTestPhrase).toHaveBeenNthCalledWith(1, store, 0, false);
      expect(selectTestPhrase).toHaveBeenNthCalledWith(2, store, 0, false);
    });

    it("does nothing on press without a point", async () => {
      renderTestPhrases(store);
      await userEvent.click(symbolButtons()[1]);
      expect(selectTestPhrase).not.toHaveBeenCalled();
    });

    it("is pressed while its slot is selected", () => {
      store = placedStore();
      renderTestPhrases(store);
      expect(symbolButtons()[0]).toHaveAttribute("aria-pressed", "false");
      act(() => store.setSelectedSlots([0]));
      expect(symbolButtons()[0]).toHaveAttribute("aria-pressed", "true");
    });
  });

  describe("a phrase with no words in common", () => {
    // A placement reply; slot 1 keeps no words
    const reply = (points: TestPhrasePoint[], status: Record<number, PlacementStatus>) =>
      act(() => store.setTestPhrasePoints(points,
        { 0: "empty", 1: "no-words", 2: "empty", 3: "empty", 4: "empty", ...status }));

    beforeEach(() => {
      store.setTestPhrase(1, "zebra");
      store.setTestPhrasePoints([], { 0: "empty", 1: "no-words", 2: "empty", 3: "empty", 4: "empty" });
    });

    it("describes the field and the button with hidden text, and gives the field a title", () => {
      renderTestPhrases(store);
      expect(field(1)).toHaveAccessibleDescription(kNoWordsText);
      expect(symbolButtons()[1]).toHaveAccessibleDescription(kNoWordsText);
      expect(field(1)).toHaveAttribute("title", kNoWordsText);
      expect(screen.getByText(kNoWordsText)).toHaveClass("visually-hidden");
    });

    it("marks its field with the no-words class, and only its field", () => {
      renderTestPhrases(store);
      expect(field(1)).toHaveClass("no-words");
      expect(field(0)).not.toHaveClass("no-words");
    });

    it("keeps the class while the focused field shows that phrase, and drops it while typing", async () => {
      renderTestPhrases(store);
      await userEvent.click(field(1));
      expect(field(1)).toHaveFocus();
      expect(field(1)).toHaveClass("no-words");
      await userEvent.keyboard("s");
      expect(field(1)).not.toHaveClass("no-words");
      await userEvent.keyboard("{Escape}");
      expect(field(1)).toHaveClass("no-words");
    });

    it("describes the field only while it shows that phrase, and the button throughout", async () => {
      renderTestPhrases(store);
      await userEvent.click(field(1));
      expect(field(1)).toHaveAccessibleDescription(kNoWordsText);
      await userEvent.keyboard("s");
      expect(field(1)).not.toHaveAccessibleDescription();
      expect(field(1).getAttribute("title") ?? "").toBe("");
      // The committed phrase still has no point
      expect(symbolButtons()[1]).toHaveAccessibleDescription(kNoWordsText);
      await userEvent.keyboard("{Escape}");
      expect(field(1)).toHaveAccessibleDescription(kNoWordsText);
      expect(field(1)).toHaveAttribute("title", kNoWordsText);
    });

    it("shows the class after Enter, while the field keeps focus", async () => {
      renderTestPhrases(store);
      await userEvent.click(field(3));
      await userEvent.keyboard("quilt{Enter}");
      expect(field(3)).not.toHaveClass("no-words");
      // The placement reply
      act(() => store.setTestPhrasePoints([], { 0: "empty", 1: "no-words", 2: "empty", 3: "no-words", 4: "empty" }));
      expect(field(3)).toHaveFocus();
      expect(field(3)).toHaveClass("no-words");
    });

    it("announces the phrase once its result comes back", async () => {
      renderTestPhrases(store);
      // Not the phrase that was already there
      expect(screen.getByRole("status")).toHaveTextContent(/^$/);
      await userEvent.click(field(3));
      await userEvent.keyboard("quilt{Enter}");
      reply([], { 3: "no-words" });
      expect(screen.getByRole("status")).toHaveTextContent(`Plus: quilt. ${kNoWordsText}`);
    });

    it("announces nothing for a phrase that is placed", async () => {
      renderTestPhrases(store);
      await userEvent.click(field(3));
      await userEvent.keyboard("the cat{Enter}");
      reply([point(3)], { 3: "placed" });
      expect(screen.getByRole("status")).toHaveTextContent(/^$/);
    });

    it("announces a phrase only once, not again for a new layout", async () => {
      renderTestPhrases(store);
      await userEvent.click(field(3));
      await userEvent.keyboard("quilt{Enter}");
      reply([], { 3: "no-words" });
      // Another change clears the message
      await userEvent.click(field(4));
      await userEvent.keyboard("the cat{Enter}");
      reply([point(4)], { 3: "no-words", 4: "placed" });
      expect(screen.getByRole("status")).toHaveTextContent(/^$/);
      // A new layout
      act(() => store.setTestPhrasePoints([], {}));
      reply([point(4)], { 3: "no-words", 4: "placed" });
      expect(screen.getByRole("status")).toHaveTextContent(/^$/);
    });

    it("dims and disables the symbol", () => {
      renderTestPhrases(store);
      expect(symbolButtons()[1]).not.toHaveAttribute("data-placed");
      expect(symbolButtons()[1]).toHaveAttribute("aria-disabled", "true");
    });

    it("has no description for other slots", () => {
      renderTestPhrases(store);
      expect(field(0)).not.toHaveAccessibleDescription();
      // React Aria sets title="" to hide validation tooltips
      expect(field(0).getAttribute("title") ?? "").toBe("");
    });
  });
});
