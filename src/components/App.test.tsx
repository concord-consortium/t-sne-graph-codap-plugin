import React from "react";
import { render, waitFor } from "@testing-library/react";
import * as codapApi from "@concord-consortium/codap-plugin-api";
import { App } from "./App";

// Replace the CODAP Plugin API with mocks, so each test can choose whether a request succeeds or fails.
jest.mock("@concord-consortium/codap-plugin-api", () => ({
  initializePlugin: jest.fn()
}));

const api = jest.mocked(codapApi);

describe("App", () => {
  beforeEach(() => {
    jest.resetAllMocks();
    api.initializePlugin.mockResolvedValue(undefined);
  });

  it("connects to CODAP with the plugin name and tile size", () => {
    render(<App/>);
    expect(api.initializePlugin).toHaveBeenCalledWith({
      pluginName: "t-SNE Plot",
      version: "0.0.1",
      dimensions: { width: 680, height: 300 }
    });
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
});
