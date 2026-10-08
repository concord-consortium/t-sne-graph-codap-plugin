// Builds hierarchical.codap through the CODAP v3 plugin API, then reloads it and checks it.
// Usage, from the project directory: node playwright/fixtures/build-hierarchical.ts
// (Node 22.18 or later runs TypeScript files directly.)
//
// A small harness page, served by Playwright, acts as the plugin and sends the API requests.
// The document is saved with saveCodapDocument, with the harness tile removed so the fixture holds
// only the table.
import fs from "fs";
import path from "path";
import { chromium, type Frame, type Page } from "@playwright/test";
// Node needs the extension to import a TypeScript file
import { exposeCodapDocument, saveCodapDocument } from "../codap-document.ts";

const kFixturePath = path.resolve("playwright/fixtures/hierarchical.codap");
const kCodap = "https://codap3.concord.org/";
const kHarness = "https://harness.test/";
const kFixtureUrl = `${kHarness}hierarchical.codap`;
const iframePhone = fs.readFileSync(path.resolve("node_modules/iframe-phone/dist/iframe-phone.js"), "utf8");

interface IRequest {
  action: string;
  resource: string;
  values?: unknown;
}
interface IReply {
  success: boolean;
  values?: unknown;
}
// The parts of a saved CODAP v3 document this script changes
interface ITileLayout {
  x: number;
  y: number;
  zIndex?: number;
}
interface IRow {
  tiles: Record<string, ITileLayout>;
  maxZIndex?: number;
}
interface IDocument {
  content: {
    rowMap: Record<string, IRow>;
    tileMap: Record<string, { content: { type: string } }>;
  };
}
// Values the harness page sets on its window
interface IHarnessWindow {
  done?: boolean;
  results?: IReply[];
}

// The harness sends `steps` in order and stores each reply in window.results
const harnessPage = (steps: IRequest[]) => `<!doctype html><html><body><script>${iframePhone}</script><script>
  const phone = new iframePhone.IframePhoneRpcEndpoint(() => ({ success: true }), "data-interactive", window.parent);
  const call = (msg) => new Promise(resolve => phone.call(msg, resolve));
  window.results = [];
  // CODAP loads the page once, then again with lang and locale added; run only on the second load
  if (location.search.includes("locale=")) (async () => {
    for (const step of ${JSON.stringify(steps)}) {
      window.results.push(await call(step));
    }
    window.done = true;
  })();
</script></body></html>`;

const frameRequest: IRequest = {
  action: "update", resource: "interactiveFrame", values: { name: "Harness", dimensions: { width: 200, height: 100 } }
};

const phrases: Record<string, string[]> = {
  Similar: ["the cat sat on the mat", "a cat rested on a rug", "the kitten lay on the carpet"],
  Opposite: ["the dog ran from the house", "a dog sprinted outside", "the puppy fled the yard"],
  Sideways: ["the bird sang in the tree", "a bird chirped on a branch", "the sparrow called at dawn"]
};
const items: Record<string, string>[] = [];
Object.entries(phrases).forEach(([label, list]) =>
  list.forEach((phrase, i) => items.push({ label, phrase, notes: `note ${label} ${i + 1}` })));

const buildSteps: IRequest[] = [
  frameRequest,
  { action: "create", resource: "dataContext", values: {
    name: "Phrases", title: "Phrases",
    collections: [
      { name: "Labels", attrs: [{ name: "label" }] },
      { name: "Phrases", parent: "Labels", attrs: [{ name: "phrase" }, { name: "notes" }] }
    ]
  } },
  { action: "create", resource: "dataContext[Phrases].item", values: items },
  { action: "create", resource: "component", values: { type: "caseTable", dataContext: "Phrases" } }
];

// Each check is a request, how to read the reply's values, and what they should be
interface ICheck {
  resource: string;
  read: (values: unknown) => unknown;
  expected: unknown;
}
const names = (values: unknown) => (values as { name: string }[]).map(value => value.name);
const same = (values: unknown) => values;
const checks: ICheck[] = [
  { resource: "dataContext[Phrases].collectionList", read: names, expected: ["Labels", "Phrases"] },
  { resource: "dataContext[Phrases].collection[Labels].attributeList", read: names, expected: ["label"] },
  { resource: "dataContext[Phrases].collection[Phrases].attributeList", read: names, expected: ["phrase", "notes"] },
  { resource: "dataContext[Phrases].collection[Labels].caseCount", read: same, expected: 3 },
  { resource: "dataContext[Phrases].collection[Phrases].caseCount", read: same, expected: 9 },
  // One item per leaf case, each carrying its parent's label
  { resource: "dataContext[Phrases].itemSearch[*]",
    read: values => (values as { values: unknown }[]).map(item => item.values), expected: items }
];

const isHarness = (f: Frame) => f.url().startsWith(kHarness) && f.url().includes("locale=");

const runHarness = async (page: Page, url: string): Promise<IReply[]> => {
  const harnessLoaded = page.waitForEvent("framenavigated", { predicate: isHarness, timeout: 60000 });
  await page.goto(url);
  const harness = await harnessLoaded;
  const handle = await harness.waitForFunction(() => {
    const harnessWindow = globalThis as IHarnessWindow;
    return harnessWindow.done && harnessWindow.results;
  }, undefined, { timeout: 60000 });
  return await handle.jsonValue() as IReply[];
};

const main = async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  await exposeCodapDocument(context);
  // What the two routes serve; changed between the build and the check
  const served = { steps: buildSteps, document: "" };
  await context.route(url => url.href.startsWith(kHarness) && url.pathname === "/",
    route => route.fulfill({ contentType: "text/html", body: harnessPage(served.steps) }));
  await context.route(kFixtureUrl, route => route.fulfill({ contentType: "application/json", body: served.document }));
  const page = await context.newPage();
  await page.setViewportSize({ width: 1400, height: 800 });

  // 1. Build the table and save the document
  const built = await runHarness(page, `${kCodap}?noEntryModal&di=${kHarness}`);
  built.forEach((reply, i) => {
    if (!reply?.success) throw new Error(`${buildSteps[i].resource} failed: ${JSON.stringify(reply)}`);
  });
  const doc = await saveCodapDocument(page) as IDocument;

  // Remove the harness tile and move the table to the top left
  const { rowMap, tileMap } = doc.content;
  let harnessTile: { id: string, layout: ITileLayout, tile: IDocument["content"]["tileMap"][string] } | undefined;
  Object.values(rowMap).forEach(row => {
    Object.keys(row.tiles).forEach(id => {
      if (tileMap[id].content.type === "CodapWebView") {
        harnessTile = { id, layout: row.tiles[id], tile: tileMap[id] };
        delete row.tiles[id];
        delete tileMap[id];
      } else {
        Object.assign(row.tiles[id], { x: 5, y: 5, zIndex: 1 });
      }
    });
    row.maxZIndex = 1;
  });
  if (!harnessTile) throw new Error("The saved document has no harness tile");
  fs.writeFileSync(kFixturePath, `${JSON.stringify(doc, null, 2)}\n`);
  process.stdout.write(`Saved ${kFixturePath}\n`);

  // 2. Reload the saved file and check it. CODAP ignores `di` when `url` loads a document,
  // so the check serves the fixture with the harness tile added back.
  const withHarness = JSON.parse(fs.readFileSync(kFixturePath, "utf8")) as IDocument;
  const firstRow = Object.values(withHarness.content.rowMap)[0];
  firstRow.tiles[harnessTile.id] = { ...harnessTile.layout, x: 700, zIndex: 2 };
  withHarness.content.tileMap[harnessTile.id] = harnessTile.tile;
  served.document = JSON.stringify(withHarness);
  served.steps = [frameRequest, ...checks.map(({ resource }) => ({ action: "get", resource }))];

  const replies = (await runHarness(page, `${kCodap}?noEntryModal&url=${kFixtureUrl}&di=${kHarness}`)).slice(1);
  let failed = false;
  checks.forEach(({ resource, read, expected }, i) => {
    const actual = replies[i]?.success ? read(replies[i].values) : replies[i];
    const passed = JSON.stringify(actual) === JSON.stringify(expected);
    failed = failed || !passed;
    process.stdout.write(`${passed ? "PASS" : "FAIL"} ${resource}${passed ? "" : ` ${JSON.stringify(actual)}`}\n`);
  });
  await browser.close();
  process.exit(failed ? 1 : 0);
};

main().catch(error => {
  console.error(error);
  process.exit(1);
});
