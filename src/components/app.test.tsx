import React from "react";
import { render, screen, within } from "@testing-library/react";
import { PluginStore } from "../models/plugin-store";
import { App } from "./app";

describe("App", () => {
  it("shows the data source dropdowns", () => {
    render(<App store={PluginStore.create()} />);
    const group = screen.getByRole("group", { name: "Data source" });
    expect(within(group).getAllByRole("button").map(button => button.textContent))
      .toEqual(["Select", "Select", "Select (optional)"]);
  });

  it("reads the selections from the store it is given", () => {
    const store = PluginStore.create({ dataContextName: "Phrases" });
    store.setDataContexts([{ name: "Phrases", title: "My Phrases" }]);
    render(<App store={store} />);
    expect(screen.getByRole("button", { name: /Data Table/ })).toHaveTextContent("My Phrases");
  });
});
