// TF-IDF with the defaults of scikit-learn's TfidfVectorizer, which the original page used.
import { log } from "./portable-math";

export interface ITfidfModel {
  // Term → column index; terms are in sorted order, as in scikit-learn
  vocabulary: Map<string, number>;
  // One value per column: log((1 + n) / (1 + df)) + 1
  idf: number[];
}

export interface ITfidfResult extends ITfidfModel {
  // One L2-normalized row per phrase; a phrase with no known term is all zeros
  matrix: number[][];
}

// Runs of anything that is not a word character. A word character is a letter, a number or "_",
// the Unicode meaning of Python's \w. JavaScript's \b only knows ASCII, so we split instead.
const kNonWordChars = /[^\p{L}\p{N}_]+/u;

/**
 * Lowercases the text and returns its words of two or more characters, in order, with repeats.
 * Equivalent to scikit-learn's default token pattern \b\w\w+\b.
 */
export const tokenize = (text: string): string[] =>
  // Array.from counts characters outside the BMP as one, as Python does
  text.toLowerCase().split(kNonWordChars).filter(token => Array.from(token).length >= 2);

// Compares by code point, as Python does. JavaScript's default sort compares UTF-16 units, which
// puts characters above U+FFFF before those in U+E000–U+FFFF.
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

/**
 * Builds the vocabulary and IDF from the phrases and returns the TF-IDF matrix, one row per phrase.
 */
export const fitTfidf = (phrases: string[]): ITfidfResult => {
  const counts = phrases.map(termCounts);
  // Number of phrases each term appears in
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

/**
 * Returns the TF-IDF row of a new phrase, using the vocabulary and IDF of an existing model.
 * Words that are not in the vocabulary are ignored.
 */
export const vectorize = (model: ITfidfModel, phrase: string): number[] => toRow(model, termCounts(phrase));
