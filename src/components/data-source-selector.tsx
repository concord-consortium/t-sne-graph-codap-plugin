import React from "react";
import { observer } from "mobx-react-lite";
import { useStore } from "../models/store-context";
import { Dropdown } from "./dropdown";
import "./data-source-selector.scss";

// The Data Table, Phrase Column and Label Column dropdowns, read from and written to the store
export const DataSourceSelector = observer(() => {
  const store = useStore();
  const hasTable = store.dataContextName !== undefined;

  return (
    <fieldset className="data-source-selector">
      {/* The group needs a name for screen readers, but the spec shows no heading */}
      <legend className="visually-hidden">Data source</legend>
      <Dropdown className="data-table-dropdown" label="Data Table"
        options={store.dataContexts.map(dc => ({ id: dc.name, label: dc.title }))}
        value={store.dataContextName} onChange={store.setDataContext} />
      <Dropdown label="Phrase Column" isDisabled={!hasTable}
        options={store.phraseAttributes.map(attr => ({ id: attr.name, label: attr.title }))}
        value={store.phraseAttributeName} onChange={store.setPhraseAttribute} />
      <Dropdown label="Label Column" isDisabled={!hasTable} placeholder="Select (optional)"
        options={store.labelAttributes.map(attr => ({ id: attr.name, label: attr.title }))}
        value={store.labelAttributeName} onChange={store.setLabelAttribute} />
    </fieldset>
  );
});
