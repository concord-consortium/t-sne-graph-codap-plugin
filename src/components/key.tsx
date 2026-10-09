import React, { useId } from "react";
import { Button } from "react-aria-components";
import { observer } from "mobx-react-lite";
import { useStore } from "../models/store-context";
import { selectInCodap } from "../models/selection-sync";
import "./key.scss";

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

/** Pressing an entry selects its label's points in CODAP; Shift adds them. With no rows, only the
 * heading shows. */
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
                {/* Long labels are cut short; the title shows the whole */}
                <span className="key-label" title={entry.label}>{entry.label}</span>
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
});
