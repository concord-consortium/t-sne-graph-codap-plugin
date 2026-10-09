import { groupLabels, kLabelColors, kUnlabeled, kUnlabeledColor, labelColor, normalizeLabel } from "./labels";

const contrastWithWhite = (hex: string) => {
  const linear = (channel: number) => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = [1, 3, 5].map(i => linear(parseInt(hex.slice(i, i + 2), 16)));
  return 1.05 / (0.2126 * r + 0.7152 * g + 0.0722 * b + 0.05);
};

describe("normalizeLabel", () => {
  it("trims, collapses whitespace and lowercases", () => {
    expect(normalizeLabel("  Very   Similar\t")).toBe("very similar");
    expect(normalizeLabel("SIMILAR")).toBe("similar");
  });

  it("lowercases the same way in every locale", () => {
    // toLocaleLowerCase in a Turkish locale would give "ıdea"
    expect(normalizeLabel("IDEA")).toBe("idea");
  });

  it("gives an empty string for blank labels", () => {
    expect(normalizeLabel("")).toBe("");
    expect(normalizeLabel(" \t\n ")).toBe("");
  });
});

describe("labelColor", () => {
  it("uses the eight fixed colors first, the spec's four leading", () => {
    expect(kLabelColors.slice(0, 4)).toEqual(["#5169ff", "#b21c00", "#ee6600", "#006963"]);
    expect(Array.from({ length: 8 }, (_value, i) => labelColor(i))).toEqual(kLabelColors);
  });

  it("generates a hex color for each label from the ninth on", () => {
    expect(labelColor(8)).toMatch(/^#[0-9a-f]{6}$/);
    expect(labelColor(8)).toBe(labelColor(8));
  });

  it("never gives two labels the same color", () => {
    const colors = Array.from({ length: 28 }, (_value, i) => labelColor(i));
    expect(new Set(colors).size).toBe(colors.length);
  });

  it("never generates a fixed, Unlabeled or test-phrase color", () => {
    const reserved = [...kLabelColors, kUnlabeledColor, "#2e007f"];
    for (let i = 8; i < 28; i++) {
      expect(reserved).not.toContain(labelColor(i));
    }
  });

  it("keeps every color at 3:1 contrast or more on white", () => {
    expect(contrastWithWhite(kUnlabeledColor)).toBeGreaterThanOrEqual(3);
    // 1000 labels cover every hue
    const tooLight = Array.from({ length: 1000 }, (_value, i) => labelColor(i))
      .filter(color => contrastWithWhite(color) < 3);
    expect(tooLight).toEqual([]);
  });
});

describe("groupLabels", () => {
  it("lists labels in order of first appearance with their colors and counts", () => {
    const { entries, rowKeys } = groupLabels(["Similar", "Opposite", "Similar", "Sideways", "Opposite"]);
    expect(entries).toEqual([
      { key: "similar", label: "Similar", color: "#5169ff", count: 2 },
      { key: "opposite", label: "Opposite", color: "#b21c00", count: 2 },
      { key: "sideways", label: "Sideways", color: "#ee6600", count: 1 }
    ]);
    expect(rowKeys).toEqual(["similar", "opposite", "similar", "sideways", "opposite"]);
  });

  it("treats labels that differ only in case or whitespace as one label", () => {
    const { entries, rowKeys } = groupLabels(["Similar", "similar", " SIMILAR ", "very  close", "Very Close"]);
    expect(entries.map(({ label, count }) => [label, count])).toEqual([["Similar", 3], ["very close", 2]]);
    expect(rowKeys).toEqual(["similar", "similar", "similar", "very close", "very close"]);
  });

  it("shows the first occurrence, trimmed and with whitespace collapsed", () => {
    expect(groupLabels(["  big   Idea ", "BIG IDEA"]).entries[0].label).toBe("big Idea");
  });

  it("puts Unlabeled first, in grey, for blank labels", () => {
    const { entries, rowKeys } = groupLabels(["Similar", "", "  ", "Opposite"]);
    expect(entries).toEqual([
      { key: "", label: kUnlabeled, color: kUnlabeledColor, count: 2 },
      { key: "similar", label: "Similar", color: "#5169ff", count: 1 },
      { key: "opposite", label: "Opposite", color: "#b21c00", count: 1 }
    ]);
    expect(rowKeys).toEqual(["similar", "", "", "opposite"]);
  });

  it("makes every row Unlabeled when there is no Label Column", () => {
    const { entries, rowKeys } = groupLabels([undefined, undefined, undefined]);
    expect(entries).toEqual([{ key: "", label: kUnlabeled, color: kUnlabeledColor, count: 3 }]);
    expect(rowKeys).toEqual(["", "", ""]);
  });

  it("gives labels after the eighth their own generated colors", () => {
    const labels = Array.from({ length: 10 }, (_value, i) => `label ${i}`);
    const { entries } = groupLabels(labels);
    expect(entries.map(entry => entry.color)).toEqual(labels.map((_label, i) => labelColor(i)));
  });

  it("does not count Unlabeled when assigning colors", () => {
    expect(groupLabels(["", "Similar"]).entries[1].color).toBe(kLabelColors[0]);
  });

  it("handles no rows", () => {
    expect(groupLabels([])).toEqual({ entries: [], rowKeys: [] });
  });
});
