// TF-IDF with scikit-learn TfidfVectorizer defaults.
import { log } from "./portable-math";

export interface ITfidfModel {
  // Terms sorted as in scikit-learn
  vocabulary: Map<string, number>;
  idf: number[];
}

export interface ITfidfResult extends ITfidfModel {
  // L2-normalized; all zeros for a phrase with no known term
  matrix: number[][];
}

// Python's Unicode \w. Split on it because JavaScript's \b is ASCII-only.
const kNonWordChars = /[^\p{L}\p{N}_]+/u;

/** Lowercased words of 2+ characters, like scikit-learn's \b\w\w+\b. */
export const tokenize = (text: string): string[] =>
  // Counts characters above U+FFFF as one, as Python does
  text.toLowerCase().split(kNonWordChars).filter(token => Array.from(token).length >= 2);

// Python sorts by code point; JavaScript's default sort uses UTF-16 units.
const byCodePoint = (a: string, b: string) => {
  const aChars = Array.from(a);
  const bChars = Array.from(b);
  for (let i = 0; i < Math.min(aChars.length, bChars.length); i++) {
    const difference = (aChars[i].codePointAt(0) ?? 0) - (bChars[i].codePointAt(0) ?? 0);
    if (difference !== 0) return difference;
  }
  return aChars.length - bChars.length;
};

const termCounts = (text: string) => {
  const counts = new Map<string, number>();
  tokenize(text).forEach(token => counts.set(token, (counts.get(token) ?? 0) + 1));
  return counts;
};

const toRow = (model: ITfidfModel, counts: Map<string, number>) => {
  const row = new Array<number>(model.idf.length).fill(0);
  counts.forEach((count, term) => {
    const column = model.vocabulary.get(term);
    if (column !== undefined) row[column] = count * model.idf[column];
  });
  const length = Math.sqrt(row.reduce((sum, value) => sum + value * value, 0));
  return length > 0 ? row.map(value => value / length) : row;
};

export const fitTfidf = (phrases: string[]): ITfidfResult => {
  const counts = phrases.map(termCounts);
  const documentFrequency = new Map<string, number>();
  counts.forEach(phraseCounts => phraseCounts.forEach((_count, term) =>
    documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1)));

  const terms = Array.from(documentFrequency.keys()).sort(byCodePoint);
  const n = phrases.length;
  const model: ITfidfModel = {
    vocabulary: new Map(terms.map((term, column) => [term, column])),
    idf: terms.map(term => log((1 + n) / (1 + (documentFrequency.get(term) ?? 0))) + 1)
  };
  return { ...model, matrix: counts.map(phraseCounts => toRow(model, phraseCounts)) };
};

// Words not in the vocabulary are ignored.
export const vectorize = (model: ITfidfModel, phrase: string): number[] => toRow(model, termCounts(phrase));
