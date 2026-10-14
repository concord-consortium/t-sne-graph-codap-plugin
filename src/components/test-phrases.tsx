import React, { KeyboardEvent, useId, useRef, useState } from "react";
import { Button, Input, TextField } from "react-aria-components";
import { observer } from "mobx-react-lite";
import { kMaxTestPhraseLength, kTestPhraseSlots, PhraseSymbol } from "../models/plugin-store";
import { selectTestPhrase } from "../models/selection-sync";
import { useStore } from "../models/store-context";
import { PhraseSymbolIcon } from "./phrase-symbol";
import "./test-phrases.scss";

// TODO: interim wording until design decides
export const kNoWordsText = "No words in common with the table's phrases";

const symbolName = (symbol: PhraseSymbol) => symbol.charAt(0).toUpperCase() + symbol.slice(1);

interface ITestPhraseRowProps {
  slot: number;
}

/** Commits its draft on blur, Tab or Enter; Escape reverts. The slot's point hides while editing. */
const TestPhraseRow = observer(({ slot }: ITestPhraseRowProps) => {
  const store = useStore();
  const noWordsId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  // Undefined when not focused: shows the committed phrase
  const [draft, setDraft] = useState<string>();
  // Set by Escape, so the blur it causes doesn't commit
  const reverting = useRef(false);
  // Stops the mouse-up after a focus from undoing the select-all
  const keepSelectionOnMouseUp = useRef(false);

  const committed = store.testPhrases[slot];
  const symbol = store.symbolForSlot(slot);
  const isDisabled = !store.phraseAttributeName;
  const hasPoint = !isDisabled && store.placedSlots.has(slot);
  const isPlaced = store.placementStatus[slot] === "placed";
  const hasNoWords = !isDisabled && store.placementStatus[slot] === "no-words";
  const showsNoWords = hasNoWords && (draft ?? committed) === committed;

  const startEditing = () => {
    if (!isDisabled && committed !== "") store.setEditingSlot(slot);
  };
  const stopEditing = () => {
    if (store.editingSlot === slot) store.setEditingSlot(undefined);
  };
  const commit = (text: string) => {
    if (!isDisabled) store.setTestPhrase(slot, text);
    stopEditing();
  };

  const handleKeyDown = (event: KeyboardEvent) => {
    // Leave IME confirm/cancel keys alone. Safari's confirming Enter follows compositionend, marked only
    // by keyCode 229.
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === "Enter") {
      commit(draft ?? committed);
      // Show it as stored
      setDraft(store.testPhrases[slot]);
    } else if (event.key === "Escape") {
      reverting.current = true;
      setDraft(undefined);
      stopEditing();
      inputRef.current?.blur();
    }
  };

  const symbolLabel = committed
    ? `${symbolName(symbol)}: ${committed}, select its point`
    : `${symbolName(symbol)}, no phrase`;

  return (
    <li className="test-phrase-row" data-disabled={isDisabled || undefined}>
      <Button
        className="test-phrase-symbol"
        aria-label={symbolLabel}
        aria-pressed={hasPoint && store.isSlotSelected(slot)}
        aria-disabled={!hasPoint || undefined}
        aria-describedby={hasNoWords ? noWordsId : undefined}
        data-placed={isPlaced || undefined}
        onPress={event => {
          if (hasPoint) selectTestPhrase(store, slot, event.shiftKey);
        }}
      >
        <PhraseSymbolIcon symbol={symbol} />
      </Button>
      <TextField
        className="test-phrase-field"
        aria-label={`Test phrase ${slot + 1}`}
        aria-describedby={hasNoWords ? noWordsId : undefined}
        isReadOnly={isDisabled}
        maxLength={kMaxTestPhraseLength}
        value={draft ?? committed}
        onChange={text => {
          setDraft(text);
          startEditing();
        }}
        onFocus={() => {
          setDraft(committed);
          startEditing();
        }}
        onBlur={() => {
          if (reverting.current) {
            reverting.current = false;
          } else {
            commit(draft ?? committed);
          }
          setDraft(undefined);
        }}
        onKeyDown={handleKeyDown}
      >
        <Input
          ref={inputRef}
          className={showsNoWords ? "test-phrase-input no-words" : "test-phrase-input"}
          // Here, since TextField drops it. Not isDisabled, which leaves the Tab order.
          aria-disabled={isDisabled || undefined}
          placeholder="Enter a phrase"
          title={hasNoWords ? kNoWordsText : undefined}
          onFocus={event => {
            event.currentTarget.select();
            keepSelectionOnMouseUp.current = true;
          }}
          onMouseDown={event => {
            // A click in a focused field places the caret
            if (event.currentTarget === document.activeElement) keepSelectionOnMouseUp.current = false;
          }}
          onMouseUp={event => {
            if (keepSelectionOnMouseUp.current) event.preventDefault();
            keepSelectionOnMouseUp.current = false;
          }}
        />
      </TextField>
      {hasNoWords && <span id={noWordsId} className="visually-hidden">{kNoWordsText}</span>}
    </li>
  );
});

/** Five phrase fields, each with a symbol button that selects its point. */
export const TestPhrases = () => {
  const headingId = useId();
  return (
    <section className="test-phrases" aria-labelledby={headingId}>
      <h2 className="test-phrases-heading" id={headingId}>Test Phrases</h2>
      <ul className="test-phrases-list">
        {Array.from({ length: kTestPhraseSlots }, (_value, slot) => <TestPhraseRow key={slot} slot={slot} />)}
      </ul>
    </section>
  );
};
