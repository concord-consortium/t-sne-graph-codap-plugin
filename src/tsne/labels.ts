// Groups rows by label and gives each label a color (CODAP-1571 plan §4.2 step 6 and §4.5).

export const kUnlabeled = "Unlabeled";
export const kUnlabeledColor = "#949494";

// The first four are the Zeplin spec's label colors. The next four are placeholders until the
// designer chooses more; they are distinguishable from the first four and from the dark purple
// (#2e007f) that is kept for test phrases.
export const kLabelColors = [
  "#5169ff", "#b21c00", "#ee6600", "#006963",
  "#d81b60", "#795548", "#827717", "#455a64"
];

// Saturation and lightness of generated colors. At 37% lightness every hue has at least 3:1
// contrast with white; at 38%, yellow hues fall just below it.
const kGeneratedSaturation = 0.6;
const kGeneratedLightness = 0.37;
// Each generated hue is the golden angle past the one before, which spreads hues as far apart as
// possible for any number of labels. The first starts away from the fixed blue and orange.
const kGoldenAngle = 137.508;
const kFirstGeneratedHue = 200;

const toHex = (value: number) => Math.round(value * 255).toString(16).padStart(2, "0");

// Converts a hue in degrees and saturation and lightness in [0, 1] to "#rrggbb"
const hslToHex = (hue: number, saturation: number, lightness: number) => {
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const channel = (n: number) => {
    const k = (n + hue / 30) % 12;
    return lightness - chroma / 2 * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return `#${toHex(channel(0))}${toHex(channel(8))}${toHex(channel(4))}`;
};

/**
 * Returns the color of the label at `index` (0-based, in order of first appearance). The first
 * eight come from kLabelColors; from the ninth on, each label gets its own generated color.
 */
export const labelColor = (index: number) => {
  if (index < kLabelColors.length) return kLabelColors[index];
  const hue = ((index - kLabelColors.length) * kGoldenAngle + kFirstGeneratedHue) % 360;
  return hslToHex(hue, kGeneratedSaturation, kGeneratedLightness);
};

const collapseWhitespace = (text: string) => text.trim().replace(/\s+/g, " ");

/**
 * Returns the form of a label used to compare labels: trimmed, with each run of whitespace made one
 * space, and lowercased. "Similar", "similar" and " Similar " all give "similar". An empty result
 * means the row is unlabeled.
 */
export const normalizeLabel = (label: string) => collapseWhitespace(label).toLowerCase();

export interface ILabelEntry {
  // The normalized label; "" for the Unlabeled entry
  key: string;
  // The text shown in the Key: the first occurrence, trimmed and with whitespace collapsed
  label: string;
  color: string;
  // Number of rows with this label
  count: number;
}

export interface ILabelGroups {
  // Unlabeled first, if any row is unlabeled; then labels in order of first appearance
  entries: ILabelEntry[];
  // The key of each row's entry, in row order
  rowKeys: string[];
}

/**
 * Groups rows by label. Pass undefined for every row when no Label Column is chosen.
 */
export const groupLabels = (labels: readonly (string | undefined)[]): ILabelGroups => {
  const unlabeled: ILabelEntry = { key: "", label: kUnlabeled, color: kUnlabeledColor, count: 0 };
  const labeled = new Map<string, ILabelEntry>();
  const rowKeys = labels.map(label => {
    const key = normalizeLabel(label ?? "");
    if (key === "") {
      unlabeled.count++;
    } else {
      const entry = labeled.get(key);
      if (entry) {
        entry.count++;
      } else {
        const shown = collapseWhitespace(label ?? "");
        labeled.set(key, { key, label: shown, color: labelColor(labeled.size), count: 1 });
      }
    }
    return key;
  });
  const entries = Array.from(labeled.values());
  return { entries: unlabeled.count > 0 ? [unlabeled, ...entries] : entries, rowKeys };
};
