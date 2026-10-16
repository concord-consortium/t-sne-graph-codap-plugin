"use strict";

// Fails the build if the built pages are wrong, so a broken template can't reach a release

const fs = require("fs");
const path = require("path");

const DEPLOY_PATH = process.env.DEPLOY_PATH;
const dist = path.resolve(__dirname, "../dist");
const failures = [];

const read = (file) => {
  const filePath = path.join(dist, file);
  if (!fs.existsSync(filePath)) {
    failures.push(`dist/${file} is missing`);
    return "";
  }
  return fs.readFileSync(filePath, "utf8");
};

// Each tag's attributes. The minifier drops quotes, so values may be unquoted.
const attributePattern = /([\w-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
const tags = (html, name) => [...html.matchAll(new RegExp(`<${name}\\b([^>]*)>`, "gi"))].map(([, attrs]) => {
  const values = {};
  for (const [, key, double, single, bare] of attrs.matchAll(attributePattern)) {
    values[key.toLowerCase()] = double ?? single ?? bare ?? "";
  }
  return values;
});

const checkInfoPageMeta = (file, expected) => {
  const html = read(file);
  if (!html) return;
  const meta = tags(html, "meta").find((attrs) => attrs.name === "t-sne-info-page");
  if (!meta) {
    failures.push(`dist/${file} has no t-sne-info-page meta tag`);
  } else if (meta.content !== expected) {
    failures.push(`dist/${file}'s t-sne-info-page meta tag is "${meta.content}", not "${expected}"`);
  }
};

const infoHtml = read("info.html");
if (infoHtml) {
  const scripts = tags(infoHtml, "script").filter((attrs) => attrs.src);
  if (scripts.length !== 1 || !/(^|\/)assets\/info\.[^/]+\.js$/.test(scripts[0].src)) {
    failures.push(`dist/info.html should load only assets/info.*.js; it loads ${
      scripts.map((attrs) => attrs.src).join(", ") || "no script"}`);
  }
  // The first heading, not a count, so adding a section doesn't break the build
  const heading = infoHtml.match(/<h2\b[^>]*>([\s\S]*?)<\/h2>/i);
  const headingText = heading?.[1].replace(/\s+/g, " ").trim();
  if (headingText !== "What is a t-SNE plot?") {
    failures.push(`dist/info.html's first h2 is ${headingText ? `"${headingText}"` : "missing"}`);
  }
}

checkInfoPageMeta("index.html", "./info.html");
if (DEPLOY_PATH) checkInfoPageMeta("index-top.html", `${DEPLOY_PATH}info.html`);

if (failures.length) {
  console.error(`check-build failed:\n${failures.map((failure) => `  - ${failure}`).join("\n")}`);
  process.exit(1);
}
process.stdout.write("check-build: the built pages are as expected\n");
