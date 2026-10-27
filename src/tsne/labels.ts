export const kUnlabeled = "Unlabeled";
export const kUnlabeledColor = "#949494";
export const kTestPhraseColor = "#2e007f";

// The spec's four colors, then placeholders until design picks more. All differ from
// `kTestPhraseColor`.
export const kLabelColors = [
  "#5169ff", "#b21c00", "#ee6600", "#006963",
  "#d81b60", "#795548", "#827717", "#455a64"
];

// Tooltip fills for the Unlabeled gray, the test-phrase purple and the four spec colors in `kLabelColors`
export const kUnlabeledTooltipFill = "#d1d1d1";
export const kTestPhraseTooltipFill = "#cbcbff";
export const kTooltipFills = ["#c0cfff", "#ffbfb2", "#ffc1a4", "#9ce0d9"];

const kTooltipFillByColor = new Map([
  [kUnlabeledColor, kUnlabeledTooltipFill],
  [kTestPhraseColor, kTestPhraseTooltipFill],
  ...kTooltipFills.map((fill, i) => [kLabelColors[i], fill] as const)
]);

// At 60% saturation and 37% lightness every hue has at least 3:1 contrast with white.
const kGeneratedSaturation = 0.6;
const kGeneratedLightness = 0.37;
// Golden-angle steps spread hues evenly for any count; the first avoids the fixed blue and orange.
const kGoldenAngle = 137.508;
const kFirstGeneratedHue = 200;

const toHex = (value: number) => Math.round(value * 255).toString(16).padStart(2, "0");

// For a "#rrggbb" color
const kTooltipMix = 0.35;
const mixWithWhite = (color: string) =>
  `#${[1, 3, 5].map(i => toHex(kTooltipMix * parseInt(color.slice(i, i + 2), 16) / 255 + 1 - kTooltipMix)).join("")}`;

/** The spec's fill, or for other colors 35% on white, roughly as light as the spec's fills */
export const tooltipFill = (color: string) => kTooltipFillByColor.get(color) ?? mixWithWhite(color);

// Hue in degrees; saturation and lightness in [0, 1]
const hslToHex = (hue: number, saturation: number, lightness: number) => {
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const channel = (n: number) => {
    const k = (n + hue / 30) % 12;
    return lightness - chroma / 2 * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return `#${toHex(channel(0))}${toHex(channel(8))}${toHex(channel(4))}`;
};

/** The fixed colors, then generated ones. Distinct for the first 424 labels; past that, generated
 * colors can repeat (678 possible). */
export const labelColor = (index: number) => {
  if (index < kLabelColors.length) return kLabelColors[index];
  const hue = ((index - kLabelColors.length) * kGoldenAngle + kFirstGeneratedHue) % 360;
  return hslToHex(hue, kGeneratedSaturation, kGeneratedLightness);
};

const collapseWhitespace = (text: string) => text.trim().replace(/\s+/g, " ");

/** Trimmed, whitespace collapsed, lowercased. "" means unlabeled. */
export const normalizeLabel = (label: string) => collapseWhitespace(label).toLowerCase();

/** As `normalizeLabel`: a test phrase exactly matches a dataset phrase when these are equal. Punctuation is
 * kept. */
export const normalizePhrase = (phrase: string) => collapseWhitespace(phrase).toLowerCase();

export interface ILabelEntry {
  // "" for Unlabeled
  key: string;
  // First occurrence, whitespace collapsed
  label: string;
  color: string;
  count: number;
}

export interface ILabelGroups {
  // Unlabeled first, then labels in order of first appearance
  entries: ILabelEntry[];
  rowKeys: string[];
}

/** Pass undefined labels when there is no Label Column. */
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
