import React from "react";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CaseInfo, IPluginStore, PluginStore, TestPhrasePoint } from "../models/plugin-store";
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

    it("caps a field at 255 characters, keeping only whole characters", async () => {
      renderTestPhrases(store);
      await userEvent.click(field(0));
      await userEvent.paste(`${"a".repeat(253)}🇺🇸bc`);
      // The flag would end at 257, so it is dropped whole
      expect(field(0)).toHaveValue("a".repeat(253));
      await userEvent.paste("de");
      expect(field(0)).toHaveValue(`${"a".repeat(253)}de`);
      await userEvent.paste("f");
      expect(field(0)).toHaveValue(`${"a".repeat(253)}de`);
    });

    it("takes no more typing anywhere in a full field, as maxLength would", async () => {
      store.setTestPhrase(0, "a".repeat(255));
      renderTestPhrases(store);
      await userEvent.click(field(0));
      await userEvent.keyboard("{Home}x");
      expect(field(0)).toHaveValue("a".repeat(255));
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

    it("does not mark an empty slot as edited until text is typed", async () => {
      renderTestPhrases(store);
      await userEvent.click(field(3));
      expect(store.editingSlot).toBeUndefined();
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

    it("enables the fields once a Phrase Column is chosen", () => {
      renderTestPhrases(store);
      act(() => store.setPhraseAttribute("phrase"));
      expect(field(0)).not.toHaveAttribute("aria-disabled");
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

    it("is disabled without a point: empty, no words, being edited, or no Phrase Column", async () => {
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
      act(() => store.setPhraseAttribute(undefined));
      expect(square).toHaveAttribute("aria-disabled", "true");
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

    it("dims and disables the symbol", () => {
      renderTestPhrases(store);
      expect(symbolButtons()[1]).not.toHaveAttribute("data-placed");
      expect(symbolButtons()[1]).toHaveAttribute("aria-disabled", "true");
    });

    it("has no description for other slots", () => {
      renderTestPhrases(store);
      expect(field(0)).not.toHaveAccessibleDescription();
      // React Aria sets an empty title to hide the browser's validation tooltip
      expect(field(0).getAttribute("title") ?? "").toBe("");
    });
  });
});
