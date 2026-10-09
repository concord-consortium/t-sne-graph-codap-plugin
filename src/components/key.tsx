import React, { useId } from "react";
import { Button } from "react-aria-components";
import { observer } from "mobx-react-lite";
import { useStore } from "../models/store-context";
import { selectInCodap } from "../models/selection-sync";
import "./key.scss";

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

/**
 * The Key (CODAP-1571 plan §4.5): one button per label, Unlabeled first, each with its color dot.
 * Pressing one selects all of that label's points in CODAP; with Shift, adds them to the selection.
 * With no rows, only the heading shows, as in the spec's default state.
 */
export const Key = observer(() => {
  const store = useStore();
  const headingId = useId();
  const entries = store.labelEntries;

  return (
    <section className="key" aria-labelledby={headingId}>
      <h2 className="key-heading" id={headingId}>Key</h2>
      {entries.length > 0 && (
        <ul className="key-list">
          {entries.map(entry => (
            <li key={entry.key}>
              <Button
                className="key-entry"
                aria-label={`${entry.label}, ${plural(entry.count, "point")}`}
                aria-pressed={entry.isSelected}
                onPress={event =>
                  selectInCodap(store, store.caseIdsByLabelKey.get(entry.key) ?? [], event.shiftKey)}
              >
                <span className="key-dot" data-testid="key-dot" aria-hidden="true"
                  style={{ backgroundColor: entry.color }} />
                {/* A label too long for the column is cut short; the title shows all of it */}
                <span className="key-label" title={entry.label}>{entry.label}</span>
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
});
