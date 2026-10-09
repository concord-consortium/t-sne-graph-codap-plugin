// Builds hierarchical.codap (Labels > Phrases, 9 phrases in 3 labels) through the CODAP v3 plugin
// API, then reloads it and checks it.
// Usage, from the project directory: node playwright/fixtures/build-hierarchical.ts
// (Node 22.18 or later runs TypeScript files directly.)
// Node needs the extension to import a TypeScript file
import { buildFixture, type ICheck, type IRequest, names, same } from "./fixture-builder.ts";

const phrases: Record<string, string[]> = {
  Similar: ["the cat sat on the mat", "a cat rested on a rug", "the kitten lay on the carpet"],
  Opposite: ["the dog ran from the house", "a dog sprinted outside", "the puppy fled the yard"],
  Sideways: ["the bird sang in the tree", "a bird chirped on a branch", "the sparrow called at dawn"]
};
const items: Record<string, string>[] = [];
Object.entries(phrases).forEach(([label, list]) =>
  list.forEach((phrase, i) => items.push({ label, phrase, notes: `note ${label} ${i + 1}` })));

const buildSteps: IRequest[] = [
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

buildFixture("hierarchical.codap", buildSteps, checks).catch(error => {
  console.error(error);
  process.exit(1);
});
