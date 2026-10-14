import React, { useId } from "react";
import { Button, Input, TextField } from "react-aria-components";
import { observer } from "mobx-react-lite";
import { kMaxTestPhraseLength, kTestPhraseSlots, PhraseSymbol } from "../models/plugin-store";
import { selectTestPhrase } from "../models/selection-sync";
import { useStore } from "../models/store-context";
import { PhraseSymbolIcon } from "./phrase-symbol";
import { usePhraseDraft } from "./use-phrase-draft";
import "./test-phrases.scss";

// TODO: interim wording until design decides
export const kNoWordsText = "No words in common with the table's phrases";

const symbolName = (symbol: PhraseSymbol) => symbol.charAt(0).toUpperCase() + symbol.slice(1);

interface ITestPhraseRowProps {
  slot: number;
}

const TestPhraseRow = observer(({ slot }: ITestPhraseRowProps) => {
  const store = useStore();
  const noWordsId = useId();

  const committed = store.testPhrases[slot];
  const symbol = store.symbolForSlot(slot);
  const isDisabled = !store.phraseAttributeName || store.computeStatus !== "done";
  const { inputRef, showsCommitted, fieldProps, inputProps } = usePhraseDraft(slot, !isDisabled);
  const hasPoint = !isDisabled && store.placedSlots.has(slot);
  const isPlaced = store.placementStatus[slot] === "placed";
  const hasNoWords = !isDisabled && store.placementStatus[slot] === "no-words";
  const showsNoWords = hasNoWords && showsCommitted;

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
        aria-describedby={showsNoWords ? noWordsId : undefined}
        isReadOnly={isDisabled}
        maxLength={kMaxTestPhraseLength}
        {...fieldProps}
      >
        <Input
          ref={inputRef}
          className={showsNoWords ? "test-phrase-input no-words" : "test-phrase-input"}
          // Here, since TextField drops it. Not isDisabled, which leaves the Tab order.
          aria-disabled={isDisabled || undefined}
          placeholder="Enter a phrase"
          title={showsNoWords ? kNoWordsText : undefined}
          {...inputProps}
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
