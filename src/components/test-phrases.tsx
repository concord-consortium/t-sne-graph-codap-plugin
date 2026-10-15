import React, { useEffect, useId, useRef, useState } from "react";
import { Button, Input, TextField } from "react-aria-components";
import { reaction } from "mobx";
import { observer } from "mobx-react-lite";
import { kMaxTestPhraseLength, kTestPhraseSlots } from "../models/plugin-store";
import { selectTestPhrase } from "../models/selection-sync";
import { useStore } from "../models/store-context";
import { PhraseSymbolIcon, symbolName } from "./phrase-symbol";
import { usePhraseDraft } from "./use-phrase-draft";
import "./test-phrases.scss";

// TODO: interim wording until design decides
export const kNoWordsText = "No words in common with the table's phrases";

interface ITestPhraseRowProps {
  slot: number;
  onPhraseChange: (slot: number) => void;
}

const TestPhraseRow = observer(({ slot, onPhraseChange }: ITestPhraseRowProps) => {
  const store = useStore();
  const noWordsId = useId();

  const committed = store.testPhrases[slot];
  const symbol = store.symbolForSlot(slot);
  const isDisabled = !store.phraseAttributeName || store.computeStatus !== "done";
  const { showsCommitted, fieldProps, inputProps } = usePhraseDraft(slot, !isDisabled, () => onPhraseChange(slot));
  const hasPoint = !isDisabled && store.placedSlots.has(slot);
  const isPlaced = store.placementStatus[slot] === "placed";
  const hasNoWords = !isDisabled && store.placementStatus[slot] === "no-words";
  const showsNoWords = hasNoWords && showsCommitted;

  const symbolLabel = !committed ? `${symbolName(symbol)}, no phrase`
    : hasPoint ? `${symbolName(symbol)}: ${committed}, select its point`
    // The no-words description gives the reason
    : hasNoWords ? `${symbolName(symbol)}: ${committed}, no point`
    : `${symbolName(symbol)}: ${committed}, no point yet`;

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
  const store = useStore();
  const headingId = useId();
  const [announcement, setAnnouncement] = useState("");
  // Slots whose phrase the student changed and that have no result yet. Only these are announced,
  // not phrases restored from the document or placed again with a new layout.
  const awaitingResult = useRef(new Set<number>());

  useEffect(() => reaction(
    () => Array.from({ length: kTestPhraseSlots }, (_value, slot) => store.placementStatus[slot]),
    statuses => statuses.forEach((status, slot) => {
      if (!status || !awaitingResult.current.has(slot)) return;
      awaitingResult.current.delete(slot);
      if (status === "no-words") {
        setAnnouncement(`${symbolName(store.symbolForSlot(slot))}: ${store.testPhrases[slot]}. ${kNoWordsText}`);
      }
    })
  ), [store]);

  const handlePhraseChange = (slot: number) => {
    awaitingResult.current.add(slot);
    // Cleared, so the same message can be announced again
    setAnnouncement("");
  };

  return (
    <section className="test-phrases" aria-labelledby={headingId}>
      <h2 className="test-phrases-heading" id={headingId}>Test Phrases</h2>
      <ul className="test-phrases-list">
        {Array.from({ length: kTestPhraseSlots }, (_value, slot) => (
          <TestPhraseRow key={slot} slot={slot} onPhraseChange={handlePhraseChange} />
        ))}
      </ul>
      <p className="visually-hidden" role="status">{announcement}</p>
    </section>
  );
};
