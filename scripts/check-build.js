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

// Each page loads only its own entry's script
const checkOnlyScript = (file, html, entry) => {
  const scripts = tags(html, "script").filter((attrs) => attrs.src);
  if (scripts.length !== 1 || !new RegExp(`(^|/)assets/${entry}\\.[^/]+\\.js$`).test(scripts[0].src)) {
    failures.push(`dist/${file} should load only assets/${entry}.*.js; it loads ${
      scripts.map((attrs) => attrs.src).join(", ") || "no script"}`);
  }
};

const checkPluginPage = (file, expectedInfoPage) => {
  const html = read(file);
  if (!html) return;
  checkOnlyScript(file, html, "index");
  const meta = tags(html, "meta").find((attrs) => attrs.name === "t-sne-info-page");
  if (!meta) {
    failures.push(`dist/${file} has no t-sne-info-page meta tag`);
  } else if (meta.content !== expectedInfoPage) {
    failures.push(`dist/${file}'s t-sne-info-page meta tag is "${meta.content}", not "${expectedInfoPage}"`);
  }
};

const infoHtml = read("info.html");
if (infoHtml) {
  checkOnlyScript("info.html", infoHtml, "info");
  // The first heading, not a count, so adding a section doesn't break the build
  const heading = infoHtml.match(/<h2\b[^>]*>([\s\S]*?)<\/h2>/i);
  const headingText = heading?.[1].replace(/\s+/g, " ").trim();
  if (headingText !== "What is a t-SNE plot?") {
    failures.push(`dist/info.html's first h2 is ${headingText ? `"${headingText}"` : "missing"}`);
  }
}

checkPluginPage("index.html", "./info.html");
// The slash is written out, not taken from DEPLOY_PATH, which s3-deploy-action sets without one
if (DEPLOY_PATH) checkPluginPage("index-top.html", `${DEPLOY_PATH.replace(/\/$/, "")}/info.html`);

if (failures.length) {
  console.error(`check-build failed:\n${failures.map((failure) => `  - ${failure}`).join("\n")}`);
  process.exit(1);
}
process.stdout.write("check-build: the built pages are as expected\n");
