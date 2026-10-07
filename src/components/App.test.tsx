import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import * as codapApi from "@concord-consortium/codap-plugin-api";
import { App } from "./App";

// Replace the CODAP Plugin API with mocks, so each test can choose whether a request succeeds or fails.
jest.mock("@concord-consortium/codap-plugin-api", () => ({
  addDataContextChangeListener: jest.fn(),
  createDataContext: jest.fn(),
  createItems: jest.fn(),
  createNewCollection: jest.fn(),
  createTable: jest.fn(),
  getAllItems: jest.fn(),
  getDataContext: jest.fn(),
  initializePlugin: jest.fn()
}));

const api = jest.mocked(codapApi);

const responseArea = () => screen.getByRole("status", { name: "Response:" });

// Mock successful requests for "Create some data", then click it and wait for "Open Table" to be enabled
const createSampleData = async () => {
  api.getDataContext.mockResolvedValue({ success: false, values: undefined });
  api.createDataContext.mockResolvedValue({ success: true, values: { name: "SamplePluginData" } });
  api.createNewCollection.mockResolvedValue({ success: true, values: {} });
  api.createItems.mockResolvedValue({ success: true, values: {} });

  fireEvent.click(screen.getByRole("button", { name: "Create some data" }));
  const openTable = screen.getByRole("button", { name: "Open Table" });
  await waitFor(() => expect(openTable).toBeEnabled());
  return openTable;
};

describe("App", () => {
  beforeEach(() => {
    jest.resetAllMocks();
    api.initializePlugin.mockResolvedValue(undefined);
  });

  it("renders without crashing", () => {
    render(<App/>);
    expect(screen.getByText("t-SNE Graph")).toBeInTheDocument();
  });

  it("logs an error when it can't connect to CODAP", async () => {
    const consoleError = jest.spyOn(console, "error").mockImplementation(() => undefined);
    api.initializePlugin.mockRejectedValue(new Error("no response"));

    render(<App/>);

    await waitFor(() => {
      expect(consoleError).toHaveBeenCalledWith("Unable to connect to CODAP:", "no response");
    });
    consoleError.mockRestore();
  });

  it("shows the response when a request succeeds", async () => {
    api.getAllItems.mockResolvedValue({ success: true, values: [{ values: { animal: "dog" } }] });

    render(<App/>);
    fireEvent.click(screen.getByRole("button", { name: "See getAllItems response" }));

    await waitFor(() => expect(responseArea()).toHaveTextContent(/"success": true/));
    expect(responseArea()).toHaveTextContent(/"animal": "dog"/);
  });

  it("shows an error when getting items fails", async () => {
    api.getAllItems.mockRejectedValue(new Error("sendRequest on closed CODAP connection"));

    render(<App/>);
    fireEvent.click(screen.getByRole("button", { name: "See getAllItems response" }));

    // Error text is shown as-is, not JSON-escaped
    await waitFor(() => {
      expect(responseArea()).toHaveTextContent(/^Error: sendRequest on closed CODAP connection$/);
    });
  });

  it("shows an error when creating data fails", async () => {
    // Failures aren't always Error objects, so the app converts other values to text
    api.getDataContext.mockRejectedValue("request failed");

    render(<App/>);
    fireEvent.click(screen.getByRole("button", { name: "Create some data" }));

    await waitFor(() => expect(responseArea()).toHaveTextContent(/^Error: request failed$/));
  });

  it("shows the response when opening the table succeeds", async () => {
    api.createTable.mockResolvedValue({ success: true, values: { type: "caseTable" } });

    render(<App/>);
    fireEvent.click(await createSampleData());

    await waitFor(() => expect(responseArea()).toHaveTextContent(/"type": "caseTable"/));
  });

  it("shows an error when opening the table fails", async () => {
    api.createTable.mockRejectedValue(new Error("table failed"));

    render(<App/>);
    fireEvent.click(await createSampleData());

    await waitFor(() => expect(responseArea()).toHaveTextContent(/^Error: table failed$/));
  });

  it("shows updated cases from the data context listener", async () => {
    render(<App/>);
    // Call the listener the app registered, as CODAP would when a case is edited
    const [, listener] = api.addDataContextChangeListener.mock.calls[0];
    act(() => {
      listener({
        action: "notify",
        resource: "dataContextChangeNotice[SamplePluginData]",
        values: { operation: "updateCases", result: { success: true, animal: "dogs" } }
      });
    });

    expect(screen.getByRole("status", { name: "Listener Notification:" })).toHaveTextContent(/"animal":"dogs"/);
  });
});
