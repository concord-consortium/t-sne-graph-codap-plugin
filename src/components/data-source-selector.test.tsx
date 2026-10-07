import React from "react";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { IPluginStore, PluginStore } from "../models/plugin-store";
import { StoreProvider } from "../models/store-context";
import { DataSourceSelector } from "./data-source-selector";

const renderSelector = (store: IPluginStore) => render(
  <StoreProvider store={store}>
    <DataSourceSelector />
  </StoreProvider>
);

const createStore = () => {
  const store = PluginStore.create();
  store.setDataContexts([{ name: "Phrases", title: "My Phrases" }, { name: "Other", title: "Other" }]);
  return store;
};
const kPhraseAttributes = [
  { name: "group", title: "Group", collectionName: "Groups", isLeaf: false },
  { name: "phrase", title: "Phrase", collectionName: "Cases", isLeaf: true },
  { name: "label", title: "Label", collectionName: "Cases", isLeaf: true }
];

// While a list is open, React Aria hides the rest of the page from screen readers
const dropdownButton = (name: string) => screen.getByRole("button", { name: new RegExp(name), hidden: true });
const optionNames = () => within(screen.getByRole("listbox")).getAllByRole("option").map(option => option.textContent);

const choose = async (user: ReturnType<typeof userEvent.setup>, dropdown: string, option: string) => {
  await user.click(dropdownButton(dropdown));
  await user.click(screen.getByRole("option", { name: option }));
};

describe("DataSourceSelector", () => {
  it("groups the three dropdowns under one name", () => {
    renderSelector(createStore());
    const group = screen.getByRole("group", { name: "Data source" });
    expect(within(group).getAllByRole("button")).toHaveLength(3);
  });

  it("disables the column dropdowns until a table is selected", async () => {
    const user = userEvent.setup();
    const store = createStore();
    renderSelector(store);
    expect(dropdownButton("Data Table")).not.toHaveAttribute("aria-disabled");
    expect(dropdownButton("Phrase Column")).toHaveAttribute("aria-disabled", "true");
    expect(dropdownButton("Label Column")).toHaveAttribute("aria-disabled", "true");
    expect(dropdownButton("Label Column")).toHaveTextContent("Select (optional)");

    await user.click(dropdownButton("Data Table"));
    expect(optionNames()).toEqual(["My Phrases", "Other"]);
    await user.click(screen.getByRole("option", { name: "My Phrases" }));
    expect(store.dataContextName).toBe("Phrases");
    expect(dropdownButton("Data Table")).toHaveTextContent("My Phrases");
    expect(dropdownButton("Phrase Column")).not.toHaveAttribute("aria-disabled");
    expect(dropdownButton("Label Column")).not.toHaveAttribute("aria-disabled");
  });

  it("lists leaf columns for Phrase and all columns for Label, and saves the choices", async () => {
    const user = userEvent.setup();
    const store = createStore();
    store.setDataContext("Phrases");
    store.setAttributes(kPhraseAttributes);
    renderSelector(store);

    await user.click(dropdownButton("Phrase Column"));
    expect(optionNames()).toEqual(["Phrase", "Label"]);
    await user.click(screen.getByRole("option", { name: "Phrase" }));
    expect(store.phraseAttributeName).toBe("phrase");

    await user.click(dropdownButton("Label Column"));
    expect(optionNames()).toEqual(["Group", "Phrase", "Label"]);
    await user.click(screen.getByRole("option", { name: "Group" }));
    expect(store.labelAttributeName).toBe("group");
  });

  it("resets both columns when a different table is chosen", async () => {
    const user = userEvent.setup();
    const store = createStore();
    store.setDataContext("Phrases");
    store.setAttributes(kPhraseAttributes);
    store.setPhraseAttribute("phrase");
    store.setLabelAttribute("label");
    renderSelector(store);
    expect(dropdownButton("Phrase Column")).toHaveTextContent("Phrase");

    await choose(user, "Data Table", "Other");
    expect(store.phraseAttributeName).toBeUndefined();
    expect(store.labelAttributeName).toBeUndefined();
    expect(dropdownButton("Phrase Column")).toHaveTextContent("Select");
    expect(dropdownButton("Label Column")).toHaveTextContent("Select (optional)");
  });

  it("clears a column with its Select item, and disables the columns when the table is cleared", async () => {
    const user = userEvent.setup();
    const store = createStore();
    store.setDataContext("Phrases");
    store.setAttributes(kPhraseAttributes);
    store.setLabelAttribute("label");
    renderSelector(store);

    await choose(user, "Label Column", "Select, clear selection");
    expect(store.labelAttributeName).toBeUndefined();

    await choose(user, "Data Table", "Select, clear selection");
    expect(store.dataContextName).toBeUndefined();
    expect(dropdownButton("Phrase Column")).toHaveAttribute("aria-disabled", "true");
  });

  it("updates when the lists from CODAP change", () => {
    const store = createStore();
    renderSelector(store);
    act(() => store.setDataContexts([{ name: "Phrases", title: "Renamed" }]));
    act(() => store.setDataContext("Phrases"));
    expect(dropdownButton("Data Table")).toHaveTextContent("Renamed");
  });
});
