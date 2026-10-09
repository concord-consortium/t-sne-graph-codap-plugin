import { ITsneRequest } from "./compute-layout";

describe("tsne-worker", () => {
  it("runs each request it receives and posts the responses back", async () => {
    // In Jest, `self` is the window; the worker sets its onmessage and calls its postMessage
    const postMessage = jest.spyOn(window, "postMessage").mockImplementation(() => undefined);
    await jest.isolateModulesAsync(async () => {
      await import("./tsne-worker");
    });
    const request: ITsneRequest = { requestId: 3, phrases: ["one", "two"], seed: 1, progressInterval: 0 };
    window.onmessage?.(new MessageEvent("message", { data: request }));
    expect(postMessage).toHaveBeenCalledWith({ type: "too-few", requestId: 3 });
    postMessage.mockRestore();
  });
});
