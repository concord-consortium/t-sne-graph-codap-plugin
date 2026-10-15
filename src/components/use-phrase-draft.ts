import { FocusEvent, KeyboardEvent, MouseEvent, useRef, useState } from "react";
import { useStore } from "../models/store-context";

/** A test-phrase field's draft, committed on blur, Tab or Enter and reverted by Escape. The draft
 * exists only once the student types, so a field focused before the saved state loads shows the
 * restored phrase, and leaving it commits nothing over it. The slot's point hides while editing.
 * `onChange` runs when a commit changes the phrase. */
export const usePhraseDraft = (slot: number, canEdit: boolean, onChange?: () => void) => {
  const store = useStore();
  const [draft, setDraft] = useState<string>();
  // Stops the mouse-up after a focus from undoing the select-all
  const keepSelectionOnMouseUp = useRef(false);
  const committed = store.testPhrases[slot];

  const startEditing = () => {
    if (canEdit && committed !== "") store.setEditingSlot(slot);
  };
  const stopEditing = () => {
    if (store.editingSlot === slot) store.setEditingSlot(undefined);
  };
  // Even when the field can't be edited now: one disabled while it was being edited keeps the draft
  const commit = () => {
    if (draft !== undefined) {
      store.setTestPhrase(slot, draft);
      if (store.testPhrases[slot] !== committed) onChange?.();
    }
    setDraft(undefined);
    stopEditing();
  };

  const onKeyDown = (event: KeyboardEvent) => {
    // Leave IME confirm/cancel keys alone. Safari's confirming Enter follows compositionend, marked only
    // by keyCode 229.
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === "Enter") {
      commit();
    } else if (event.key === "Escape") {
      setDraft(undefined);
      stopEditing();
    }
  };

  return {
    // Not a new draft
    showsCommitted: draft === undefined || draft === committed,
    fieldProps: {
      value: draft ?? committed,
      onChange: (text: string) => {
        setDraft(text);
        startEditing();
      },
      onFocus: startEditing,
      onBlur: commit,
      onKeyDown
    },
    inputProps: {
      onFocus: (event: FocusEvent<HTMLInputElement>) => {
        event.currentTarget.select();
        keepSelectionOnMouseUp.current = true;
      },
      onMouseDown: (event: MouseEvent<HTMLInputElement>) => {
        // A click in a focused field places the caret
        if (event.currentTarget === document.activeElement) keepSelectionOnMouseUp.current = false;
      },
      onMouseUp: (event: MouseEvent<HTMLInputElement>) => {
        if (keepSelectionOnMouseUp.current) event.preventDefault();
        keepSelectionOnMouseUp.current = false;
      }
    }
  };
};
