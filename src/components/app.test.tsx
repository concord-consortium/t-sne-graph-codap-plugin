import React from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PluginStore } from "../models/plugin-store";
import { App } from "./app";

describe("App", () => {
  it("shows the data source dropdowns", () => {
    render(<App store={PluginStore.create()} />);
    const group = screen.getByRole("group", { name: "Data source" });
    expect(within(group).getAllByRole("button").map(button => button.textContent))
      .toEqual(["Select", "Select", "Select (optional)"]);
  });

  it("puts the info button after the dropdowns, outside their group", () => {
    render(<App store={PluginStore.create()} />);
    const group = screen.getByRole("group", { name: "Data source" });
    const infoButton = screen.getByRole("button", { name: "Information about t-SNE plots" });
    expect(group.compareDocumentPosition(infoButton)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(within(group).getAllByRole("button")).toHaveLength(3);
  });

  it("reaches the info button with Tab right after the Label Column dropdown", async () => {
    const user = userEvent.setup();
    render(<App store={PluginStore.create()} />);
    screen.getByRole("button", { name: /Label Column/ }).focus();
    await user.tab();
    expect(screen.getByRole("button", { name: "Information about t-SNE plots" })).toHaveFocus();
  });

  it("reads the selections from the store it is given", () => {
    const store = PluginStore.create({ dataContextName: "Phrases" });
    store.setDataContexts([{ name: "Phrases", title: "My Phrases" }]);
    render(<App store={store} />);
    expect(screen.getByRole("button", { name: /Data Table/ })).toHaveTextContent("My Phrases");
  });
});
