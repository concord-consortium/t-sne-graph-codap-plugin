import type { BrowserContext, Page } from "@playwright/test";

// CODAP's document model. CODAP sets it as window.currentDocument when its `debug` local-storage
// value includes "document".
interface ICodapDocument {
  prepareSnapshot(): Promise<void>;
  completeSnapshot(): void;
  toJSON(): unknown;
}

// Makes CODAP set window.currentDocument in every page opened afterward
export const exposeCodapDocument = (target: Page | BrowserContext) =>
  target.addInitScript(() => globalThis.localStorage.setItem("debug", "document"));

// Saves the open document the way CODAP's own save does: prepareSnapshot (which asks each plugin for
// its state), then the MST snapshot (toJSON), then completeSnapshot. Needs exposeCodapDocument
// first.
export const saveCodapDocument = (page: Page): Promise<object> => page.evaluate(async () => {
  const codapDocument = (globalThis as unknown as { currentDocument: ICodapDocument }).currentDocument;
  await codapDocument.prepareSnapshot();
  try {
    return JSON.parse(JSON.stringify(codapDocument.toJSON()));
  } finally {
    codapDocument.completeSnapshot();
  }
});
