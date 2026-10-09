// Builds flat.codap (one collection, 40 phrases: 13 each Similar, Opposite and Sideways, and one
// with no label) through the CODAP v3 plugin API, then reloads it and checks it. It gives a
// realistic picture and a timing check for the plot.
// Usage, from the project directory: node playwright/fixtures/build-flat.ts
// (Node 22.18 or later runs TypeScript files directly.)
// Node needs the extension to import a TypeScript file
import { buildFixture, type ICheck, type IRequest, names, same } from "./fixture-builder.ts";

const phrases: Record<string, string[]> = {
  Similar: [
    "Everyone around the world shares this", "All people everywhere feel the same",
    "Every single person on the planet", "People in every country agree", "The whole world joins together",
    "All of us, no matter where we live", "Every voice across the globe", "Each person in every nation",
    "Humans everywhere share one home", "All the people of the earth", "Everybody in the whole wide world",
    "Every family in every town", "People from all places come together"
  ],
  Opposite: [
    "Nobody anywhere feels this way", "No person exists on their own", "Not a single soul is left out",
    "No one stands completely alone", "Nobody else is around", "No strangers live here",
    "Not one person is a stranger", "No one is ever truly isolated", "Nobody walks this road alone",
    "None of us are by ourselves", "No people are left behind", "Not anyone outside our circle",
    "No one lives in isolation"
  ],
  Sideways: [
    "Some of the other kids at school", "A few of my closest friends", "Those stuck in their old ways",
    "Like a lot of my friends", "Some people on my street", "A handful of kids in my class",
    "Several of my cousins", "Only the ones who sit near me", "Some neighbors down the block",
    "Just a couple of my teammates", "Kids who ride my bus", "A few people I know", "Some friends from camp"
  ],
  "": ["People I have never met"]
};
// Labels and phrases interleaved, as a class's table would be, rather than grouped by label
const items: Record<string, string>[] = [];
for (let i = 0; i < 13; i++) {
  ["Similar", "Opposite", "Sideways"].forEach(label => items.push({ phrase: phrases[label][i], label }));
  if (i === 6) items.push({ phrase: phrases[""][0], label: "" });
}

const buildSteps: IRequest[] = [
  { action: "create", resource: "dataContext", values: {
    name: "Phrases", title: "Phrases",
    collections: [{ name: "Phrases", attrs: [{ name: "phrase" }, { name: "label" }] }]
  } },
  { action: "create", resource: "dataContext[Phrases].item", values: items },
  { action: "create", resource: "component", values: { type: "caseTable", dataContext: "Phrases" } }
];

const checks: ICheck[] = [
  { resource: "dataContext[Phrases].collectionList", read: names, expected: ["Phrases"] },
  { resource: "dataContext[Phrases].collection[Phrases].attributeList", read: names, expected: ["phrase", "label"] },
  { resource: "dataContext[Phrases].collection[Phrases].caseCount", read: same, expected: 40 },
  { resource: "dataContext[Phrases].itemSearch[*]",
    read: values => (values as { values: unknown }[]).map(item => item.values), expected: items }
];

buildFixture("flat.codap", buildSteps, checks).catch(error => {
  console.error(error);
  process.exit(1);
});
