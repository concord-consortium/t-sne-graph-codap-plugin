import React from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { codapInterface } from "@concord-consortium/codap-plugin-api";
import { openInfoTile } from "../models/info-tile";
import { IPluginStore, PluginStore } from "../models/plugin-store";
import { App } from "./app";

jest.mock("../models/info-tile", () => ({
  ...jest.requireActual("../models/info-tile"),
  openInfoTile: jest.fn()
}));

const mockOpenInfoTile = jest.mocked(openInfoTile);

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

describe("App's info button", () => {
  let store: IPluginStore;
  let connectionState: string;
  let warn: jest.SpyInstance;

  const pressInfo = () => fireEvent.click(screen.getByRole("button", { name: "Information about t-SNE plots" }));
  const renderApp = (status: "connecting" | "connected" | "failed") => {
    store.setCodapStatus(status);
    render(<App store={store} />);
  };

  beforeEach(() => {
    store = PluginStore.create();
    connectionState = "active";
    jest.spyOn(codapInterface, "getConnectionState").mockImplementation(() => connectionState);
    warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    mockOpenInfoTile.mockResolvedValue("opened");
  });

  afterEach(() => {
    jest.restoreAllMocks();
    mockOpenInfoTile.mockReset();
  });

  it("opens the tile when connected", async () => {
    renderApp("connected");
    await act(async () => pressInfo());
    expect(mockOpenInfoTile).toHaveBeenCalledTimes(1);
  });

  it("opens the tile when a CODAP answers after init gave up", async () => {
    renderApp("failed");
    await act(async () => pressInfo());
    expect(mockOpenInfoTile).toHaveBeenCalledTimes(1);
  });

  it("only warns when there is no connection", async () => {
    connectionState = "closed";
    renderApp("failed");
    await act(async () => pressInfo());
    expect(warn).toHaveBeenCalledWith("CODAP is not connected; the information tile can't be opened");
    expect(mockOpenInfoTile).not.toHaveBeenCalled();
  });

  it("waits for init while connecting, then opens the tile", async () => {
    connectionState = "preinit";
    renderApp("connecting");
    await act(async () => pressInfo());
    expect(mockOpenInfoTile).not.toHaveBeenCalled();
    connectionState = "active";
    await act(async () => store.setCodapStatus("connected"));
    expect(mockOpenInfoTile).toHaveBeenCalledTimes(1);
  });

  it("waits for init while connecting, then only warns if it fails", async () => {
    connectionState = "preinit";
    renderApp("connecting");
    await act(async () => pressInfo());
    connectionState = "closed";
    await act(async () => store.setCodapStatus("failed"));
    expect(warn).toHaveBeenCalledWith("CODAP is not connected; the information tile can't be opened");
    expect(mockOpenInfoTile).not.toHaveBeenCalled();
  });
});
