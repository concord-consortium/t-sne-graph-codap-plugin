import { codapInterface } from "@concord-consortium/codap-plugin-api";

jest.mock("@concord-consortium/codap-plugin-api", () => ({
  codapInterface: { init: jest.fn() }
}));

const init = jest.mocked(codapInterface.init);

// info.ts connects when it loads, so each test loads a fresh copy
const loadPage = () => jest.isolateModulesAsync(async () => { await import("./info"); });

describe("info page entry", () => {
  afterEach(() => {
    init.mockReset();
    jest.restoreAllMocks();
  });

  it("connects with the tile's name and the plugin's version, and no dimensions", async () => {
    init.mockResolvedValue(undefined);
    await loadPage();
    // Strict, so a dimensions key fails even when undefined
    expect(init.mock.calls).toStrictEqual([[{ name: "Information: t-SNE Plots", version: "0.0.1" }]]);
  });

  it("warns instead of throwing when the connection fails", async () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    const error = new Error("no CODAP");
    init.mockRejectedValue(error);
    await expect(loadPage()).resolves.toBeUndefined();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(warn).toHaveBeenCalledWith("The information page could not connect to CODAP:", error);
  });
});
