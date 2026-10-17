import { mergeTests } from "@playwright/test";
import { test as coverageTest} from "@bgotink/playwright-coverage";
import { exposeCodapDocument } from "./codap-document";

export const test = mergeTests(
  // coverageTest will be enabled only in CI by playwright.config.ts
  coverageTest,
).extend<{ codapDocumentExposed: void }>({
  // Runs before each test, so any test can save the CODAP document (see codap-document.ts)
  codapDocumentExposed: [async ({ page }, use) => {
    await exposeCodapDocument(page);
    await use();
  }, { auto: true }],
});
