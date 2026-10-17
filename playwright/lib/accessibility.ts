import { AxeBuilder } from "@axe-core/playwright";
import type { Page } from "@playwright/test";

// Each WCAG 2 A/AA violation in the plugin, as its rule and the elements it flagged, so a failure is
// readable. Only the plugin's frame is checked, not CODAP. axe's best-practice rules (a main
// landmark, an h1) are left out: they suit whole pages, and the plugin is a tile inside CODAP, which
// shows the title.
export const axeViolations = async (page: Page) => {
  const { violations } = await new AxeBuilder({ page })
    .include([".codap-web-view-iframe", "body"])
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  return violations.map(({ id, nodes }) => ({ id, elements: nodes.map(node => node.target.join(" ")) }));
};
