import * as codapApi from "@concord-consortium/codap-plugin-api";
import { IResult } from "@concord-consortium/codap-plugin-api";
import { infoPageUrl, openInfoTile, updateSavedInfoTile } from "./info-tile";

jest.mock("@concord-consortium/codap-plugin-api", () => ({
  codapInterface: { sendRequest: jest.fn() },
  sendMessage: jest.fn()
}));

const api = jest.mocked(codapApi);

interface IRequest {
  action: string;
  resource: string;
  values?: unknown;
}

// Keyed by "action resource"; a test replaces one to make that request fail
let replies: Record<string, () => IResult | Promise<IResult>>;
let requests: IRequest[];
const ok = (values?: unknown): IResult => ({ success: true, values });
const refused: IResult = { success: false, values: { error: "refused" } };

const answer = (request: IRequest) => {
  requests.push(request);
  const reply = replies[`${request.action} ${request.resource}`];
  return Promise.resolve(reply ? reply() : refused);
};

const requestsTo = (action: string, resource: string) =>
  requests.filter(request => request.action === action && request.resource === resource);
const created = () => requestsTo("create", "component");

const setMeta = (content: string) => {
  const meta = document.createElement("meta");
  meta.name = "t-sne-info-page";
  meta.content = content;
  document.head.append(meta);
};

const infoTile = { id: 7, name: "Information: t-SNE Plots", title: "Information: t-SNE Plots", type: "game" };
const kOldUrl = "https://models-resources.concord.org/t-sne-graph-codap-plugin/version/v1.0.0/info.html";

describe("infoPageUrl", () => {
  afterEach(() => {
    document.head.innerHTML = "";
    jest.restoreAllMocks();
  });

  const kAbsolute = "https://models-resources.concord.org/t-sne-graph-codap-plugin/version/v1.2.0/info.html";
  const fromPage = (address: string) => new URL(address, document.baseURI).href;
  it.each([
    ["./info.html", "the page's own folder", fromPage("info.html")],
    ["version/v1.2.0/info.html", "a release's version folder", fromPage("version/v1.2.0/info.html")],
    [kAbsolute, "an absolute URL, kept as given", kAbsolute]
  ])("resolves the meta tag's %s (%s)", (content, _case, expected) => {
    setMeta(content);
    expect(infoPageUrl()).toBe(expected);
  });

  it("falls back to info.html beside the page, with a warning, when the tag is missing", () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(infoPageUrl()).toBe(new URL("info.html", document.baseURI).href);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("t-sne-info-page"));
  });
});

const fakeCodap = () => {
  setMeta("./info.html");
  requests = [];
  replies = {
    "get componentList": () => ok([{ id: 1, name: "t-SNE Plot", title: "t-SNE Plot", type: "game" }]),
    // A different id from the plugin's componentList entry, so the position lookup must use the frame's
    "get interactiveFrame": () => ok({ id: 3, dimensions: { width: 680, height: 334 } }),
    "get component[3]": () => ok({ id: 3, position: { left: 40, top: 60 }, dimensions: { width: 680, height: 334 } }),
    "create component": () => ok({ id: 7 }),
    "get component[7]": () => ok({ id: 7, URL: new URL("info.html", document.baseURI).href }),
    "update component[7]": () => ok(),
    "notify component[7]": () => ok()
  };
  api.sendMessage.mockImplementation((action, resource, values) => answer({ action, resource, values }));
  api.codapInterface.sendRequest.mockImplementation(request => answer(request as IRequest));
};

const tileWithOldUrl = () => {
  replies["get componentList"] = () => ok([infoTile]);
  replies["get component[7]"] = () => ok({ id: 7, URL: kOldUrl });
};

describe("openInfoTile", () => {
  let warn: jest.SpyInstance;

  beforeEach(() => {
    fakeCodap();
    warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    document.head.innerHTML = "";
    jest.restoreAllMocks();
  });

  it("creates the tile 10px right of the plugin when the document has none", async () => {
    expect(await openInfoTile()).toBe("opened");
    expect(created()).toHaveLength(1);
    expect(created()[0].values).toEqual({
      type: "webView",
      name: "Information: t-SNE Plots",
      title: "Information: t-SNE Plots",
      URL: new URL("info.html", document.baseURI).href,
      dimensions: { width: 450, height: 300 },
      position: { left: 40 + 680 + 10, top: 60 }
    });
  });

  it("brings an existing tile to the front instead of creating one", async () => {
    replies["get componentList"] = () => ok([infoTile]);
    expect(await openInfoTile()).toBe("opened");
    expect(requestsTo("notify", "component[7]")).toEqual([
      { action: "notify", resource: "component[7]", values: { request: "select" } }
    ]);
    expect(created()).toHaveLength(0);
  });

  it("points an existing tile with an old address at this build's page, then brings it to the front", async () => {
    tileWithOldUrl();
    expect(await openInfoTile()).toBe("opened");
    const updateAndSelect = requests.filter(({ action }) => action === "update" || action === "notify");
    expect(updateAndSelect).toEqual([
      { action: "update", resource: "component[7]", values: { URL: new URL("info.html", document.baseURI).href } },
      { action: "notify", resource: "component[7]", values: { request: "select" } }
    ]);
  });

  it("leaves the address of an existing tile that already has this build's page", async () => {
    replies["get componentList"] = () => ok([infoTile]);
    expect(await openInfoTile()).toBe("opened");
    expect(requestsTo("get", "component[7]")).toHaveLength(1);
    expect(requestsTo("update", "component[7]")).toHaveLength(0);
  });

  it.each(["get component[7]", "update component[7]"])(
    "still brings the tile to the front, with a warning, when %s is refused", async (failing) => {
      tileWithOldUrl();
      replies[failing] = () => refused;
      expect(await openInfoTile()).toBe("opened");
      expect(warn).toHaveBeenCalledWith("Unable to update the information tile's address:", new Error("refused"));
      expect(requestsTo("notify", "component[7]")).toHaveLength(1);
    });

  it("finds a tile listed as a web view, before its page has connected", async () => {
    replies["get componentList"] = () => ok([{ ...infoTile, type: "webView" }]);
    expect(await openInfoTile()).toBe("opened");
    expect(created()).toHaveLength(0);
  });

  it("places the tile beside a plugin at the document's top-left corner", async () => {
    replies["get component[3]"] = () => ok({ id: 3, position: { left: 0, top: 0 }, dimensions: { width: 680 } });
    expect(await openInfoTile()).toBe("opened");
    expect(created()[0].values).toHaveProperty("position", { left: 0 + 680 + 10, top: 0 });
  });

  it("ignores a component with the same name but no type", async () => {
    replies["get componentList"] = () => ok([{ id: 7, name: "Information: t-SNE Plots" }]);
    expect(await openInfoTile()).toBe("opened");
    expect(created()).toHaveLength(1);
  });

  it("ignores a component of another type with the same name", async () => {
    replies["get componentList"] = () => ok([{ ...infoTile, type: "text" }]);
    expect(await openInfoTile()).toBe("opened");
    expect(created()).toHaveLength(1);
  });

  it.each(["get interactiveFrame", "get component[3]"])(
    "creates the tile without a position when %s fails", async (failing) => {
      replies[failing] = () => refused;
      expect(await openInfoTile()).toBe("opened");
      expect(created()[0].values).not.toHaveProperty("position");
    });

  it("creates the tile without a position when the plugin's position is missing", async () => {
    replies["get component[3]"] = () => ok({ id: 3 });
    expect(await openInfoTile()).toBe("opened");
    expect(created()[0].values).not.toHaveProperty("position");
  });

  it.each(["get componentList", "create component"])("fails, with a warning, when %s is refused", async (failing) => {
    replies[failing] = () => refused;
    expect(await openInfoTile()).toBe("failed");
    expect(warn).toHaveBeenCalledWith("Unable to open the information tile:", new Error("refused"));
  });

  it("fails when bringing the existing tile to the front is refused", async () => {
    replies["get componentList"] = () => ok([infoTile]);
    replies["notify component[7]"] = () => refused;
    expect(await openInfoTile()).toBe("failed");
  });

  it("fails when a request is rejected", async () => {
    replies["get componentList"] = () => Promise.reject(new Error("timed out"));
    expect(await openInfoTile()).toBe("failed");
  });

  it("shares one open between calls made before it finishes", async () => {
    const first = openInfoTile();
    const second = openInfoTile();
    expect(await Promise.all([first, second])).toEqual(["opened", "opened"]);
    expect(requestsTo("get", "componentList")).toHaveLength(1);
    expect(created()).toHaveLength(1);
  });

  it("starts a new open after a failed one", async () => {
    replies["get componentList"] = () => refused;
    expect(await openInfoTile()).toBe("failed");
    replies["get componentList"] = () => ok([]);
    expect(await openInfoTile()).toBe("opened");
    expect(requestsTo("get", "componentList")).toHaveLength(2);
  });

  it("starts a new open once the last one has finished", async () => {
    await openInfoTile();
    replies["get componentList"] = () => ok([infoTile]);
    await openInfoTile();
    expect(requestsTo("get", "componentList")).toHaveLength(2);
    expect(created()).toHaveLength(1);
    expect(requestsTo("notify", "component[7]")).toHaveLength(1);
  });
});

describe("updateSavedInfoTile", () => {
  let warn: jest.SpyInstance;

  beforeEach(() => {
    fakeCodap();
    warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    document.head.innerHTML = "";
    jest.restoreAllMocks();
  });

  it("points a saved tile with an old address at this build's page, without bringing it to the front", async () => {
    tileWithOldUrl();
    await updateSavedInfoTile();
    expect(requestsTo("update", "component[7]")).toEqual([
      { action: "update", resource: "component[7]", values: { URL: new URL("info.html", document.baseURI).href } }
    ]);
    expect(requestsTo("notify", "component[7]")).toHaveLength(0);
  });

  it("changes nothing when the document has no information tile", async () => {
    await updateSavedInfoTile();
    expect(requests.map(({ action, resource }) => `${action} ${resource}`)).toEqual(["get componentList"]);
  });

  it("only warns when the component list is refused", async () => {
    replies["get componentList"] = () => refused;
    await expect(updateSavedInfoTile()).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith("Unable to look for the information tile:", new Error("refused"));
  });
});
