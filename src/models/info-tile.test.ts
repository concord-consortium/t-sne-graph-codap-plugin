import * as codapApi from "@concord-consortium/codap-plugin-api";
import { IResult } from "@concord-consortium/codap-plugin-api";
import { infoPageUrl, openInfoTile } from "./info-tile";

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

// Replies by "action resource"; a test replaces one to make that request fail
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

describe("infoPageUrl", () => {
  afterEach(() => {
    document.head.innerHTML = "";
    jest.restoreAllMocks();
  });

  it("resolves the meta tag's ./info.html against the page", () => {
    setMeta("./info.html");
    expect(infoPageUrl()).toBe(new URL("info.html", document.baseURI).href);
  });

  it("resolves a release's version folder against the top level", () => {
    setMeta("version/v1.2.0/info.html");
    expect(infoPageUrl()).toBe(new URL("version/v1.2.0/info.html", document.baseURI).href);
  });

  it("keeps an absolute URL as given", () => {
    setMeta("https://models-resources.concord.org/t-sne-graph-codap-plugin/version/v1.2.0/info.html");
    expect(infoPageUrl())
      .toBe("https://models-resources.concord.org/t-sne-graph-codap-plugin/version/v1.2.0/info.html");
  });

  it("falls back to info.html beside the page, with a warning, when the tag is missing", () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(infoPageUrl()).toBe(new URL("info.html", document.baseURI).href);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("t-sne-info-page"));
  });
});

describe("openInfoTile", () => {
  let warn: jest.SpyInstance;

  beforeEach(() => {
    setMeta("./info.html");
    requests = [];
    replies = {
      "get componentList": () => ok([{ id: 1, name: "t-SNE Plot", title: "t-SNE Plot", type: "game" }]),
      "get interactiveFrame": () => ok({ id: 1, dimensions: { width: 680, height: 334 } }),
      "get component[1]": () => ok({ id: 1, position: { left: 40, top: 60 }, dimensions: { width: 680, height: 334 } }),
      "create component": () => ok({ id: 7 }),
      "notify component[7]": () => ok()
    };
    api.sendMessage.mockImplementation((action, resource, values) => answer({ action, resource, values }));
    api.codapInterface.sendRequest.mockImplementation(request => answer(request as IRequest));
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

  it("finds a tile listed as a web view, before its page has connected", async () => {
    replies["get componentList"] = () => ok([{ ...infoTile, type: "webView" }]);
    expect(await openInfoTile()).toBe("opened");
    expect(created()).toHaveLength(0);
  });

  it("ignores a component of another type with the same name", async () => {
    replies["get componentList"] = () => ok([{ ...infoTile, type: "text" }]);
    expect(await openInfoTile()).toBe("opened");
    expect(created()).toHaveLength(1);
  });

  it.each(["get interactiveFrame", "get component[1]"])(
    "creates the tile without a position when %s fails", async (failing) => {
      replies[failing] = () => refused;
      expect(await openInfoTile()).toBe("opened");
      expect(created()[0].values).not.toHaveProperty("position");
    });

  it("creates the tile without a position when the plugin's position is missing", async () => {
    replies["get component[1]"] = () => ok({ id: 1 });
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

  it("starts a new open once the last one has finished", async () => {
    await openInfoTile();
    replies["get componentList"] = () => ok([infoTile]);
    await openInfoTile();
    expect(requestsTo("get", "componentList")).toHaveLength(2);
    expect(created()).toHaveLength(1);
    expect(requestsTo("notify", "component[7]")).toHaveLength(1);
  });
});
