jest.mock("./components/app", () => ({ App: () => null }));
jest.mock("./models/codap-sync", () => ({ startCodapSync: jest.fn() }));
jest.mock("./models/graph-controller", () => ({ startGraphController: jest.fn() }));
jest.mock("./models/selection-sync", () => ({ startSelectionSync: jest.fn() }));
jest.mock("./models/info-tile", () => ({ updateSavedInfoTile: jest.fn() }));

// index.tsx starts the plugin when it loads, so each test loads a fresh copy with fresh mocks
const startPlugin = async (connected: boolean) => {
  let updateSavedInfoTile: jest.Mock | undefined;
  await jest.isolateModulesAsync(async () => {
    const { startCodapSync } = await import("./models/codap-sync");
    jest.mocked(startCodapSync).mockResolvedValue(connected);
    await import("./index");
    await new Promise(resolve => setTimeout(resolve, 0));
    updateSavedInfoTile = jest.mocked((await import("./models/info-tile")).updateSavedInfoTile);
  });
  return updateSavedInfoTile;
};

describe("plugin startup", () => {
  it("brings a saved information tile's address up to date once connected", async () => {
    expect(await startPlugin(true)).toHaveBeenCalledTimes(1);
  });

  it("leaves the information tile alone when the connection fails", async () => {
    expect(await startPlugin(false)).not.toHaveBeenCalled();
  });
});
