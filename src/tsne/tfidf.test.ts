import { fitTfidf, tokenize, vectorize } from "./tfidf";

// Same length, each value within `digits` of the expected one
const closeTo = (expected: number[], digits = 12) => expected.map(value => expect.closeTo(value, digits));

const rowLength = (row: number[]) => Math.sqrt(row.reduce((sum, value) => sum + value * value, 0));

describe("tokenize", () => {
  it("lowercases and keeps words of two or more characters", () => {
    expect(tokenize("The cat sat on a Mat")).toEqual(["the", "cat", "sat", "on", "mat"]);
  });

  it("splits on punctuation and whitespace, as \\b\\w\\w+\\b does", () => {
    expect(tokenize("don't stop -- well,done!\tok")).toEqual(["don", "stop", "well", "done", "ok"]);
  });

  it("keeps numbers and underscores as word characters", () => {
    expect(tokenize("route_66 in 2024 x1")).toEqual(["route_66", "in", "2024", "x1"]);
  });

  it("keeps letters outside ASCII", () => {
    expect(tokenize("Café CRÈME naïve über")).toEqual(["café", "crème", "naïve", "über"]);
  });

  it("keeps repeats, in order", () => {
    expect(tokenize("the the cat")).toEqual(["the", "the", "cat"]);
  });

  it("returns nothing for text with no word of two or more characters", () => {
    expect(tokenize("a b c ! 7")).toEqual([]);
    expect(tokenize("")).toEqual([]);
  });
});

describe("fitTfidf", () => {
  // By hand: tokens [the, cat, sat], [the, dog, sat], [dog] ("a" drops out); df is 1 for cat,
  // 2 for the rest.
  const rare = Math.log(4 / 2) + 1;
  const common = Math.log(4 / 3) + 1;

  it("matches hand-computed values", () => {
    const { vocabulary, idf, matrix } = fitTfidf(["the cat sat", "the dog sat", "a dog"]);
    expect(Array.from(vocabulary.entries())).toEqual([["cat", 0], ["dog", 1], ["sat", 2], ["the", 3]]);
    expect(idf).toEqual(closeTo([rare, common, common, common]));

    const length1 = Math.sqrt(rare ** 2 + 2 * common ** 2);
    expect(matrix[0]).toEqual(closeTo([rare / length1, 0, common / length1, common / length1]));
    // One shared idf, so each is 1 / √3
    expect(matrix[1]).toEqual(closeTo([0, 1 / Math.sqrt(3), 1 / Math.sqrt(3), 1 / Math.sqrt(3)]));
    expect(matrix[2]).toEqual(closeTo([0, 1, 0, 0]));
  });

  it("counts a repeated word in a phrase", () => {
    // n = 2, so idf(the) = ln(3 / 3) + 1 = 1
    const { matrix } = fitTfidf(["the the cat", "the dog"]);
    const catIdf = Math.log(3 / 2) + 1;
    const length = Math.sqrt(catIdf ** 2 + 2 ** 2);
    expect(matrix[0]).toEqual(closeTo([catIdf / length, 0, 2 / length]));
  });

  it("gives every phrase with a known word a row of length 1", () => {
    const { matrix } = fitTfidf(["one fish", "two fish", "red fish blue fish"]);
    matrix.forEach(row => expect(rowLength(row)).toBeCloseTo(1, 12));
  });

  it("gives a phrase with no word of two or more characters a row of zeros", () => {
    const { matrix } = fitTfidf(["the cat", "a b c", "42 dogs"]);
    expect(matrix[1]).toEqual([0, 0, 0, 0]);
  });

  it("sorts the vocabulary by code point, as Python does", () => {
    // By code point U+F900 comes first; by UTF-16 unit U+10428 (U+D801 U+DC28) would
    const { vocabulary } = fitTfidf(["\u{10428}a", "\uF900a"]);
    expect(Array.from(vocabulary.keys())).toEqual(["\uF900a", "\u{10428}a"]);
  });

  it("handles no phrases", () => {
    expect(fitTfidf([])).toEqual({ vocabulary: new Map(), idf: [], matrix: [] });
  });

  describe("matches scikit-learn", () => {
    // From scikit-learn 1.9.1, rounded to 12 places:
    //   v = TfidfVectorizer(); m = v.fit_transform(phrases).toarray()
    //   v.get_feature_names_out(), v.idf_, m, v.transform(["the mat and the zebra"]).toarray()
    const phrases = [
      "The cat sat on the mat.",
      "A cat rested on a rug",
      "The dog ran from the house!",
      "Café owners don't nap"
    ];
    const kVocabulary = [
      "café", "cat", "dog", "don", "from", "house", "mat", "nap", "on", "owners", "ran", "rested", "rug",
      "sat", "the"
    ];
    const a = 1.916290731874155;   // idf, term in one phrase
    const b = 1.5108256237659907;  // idf, term in two phrases
    const kIdf = [a, b, a, a, a, a, a, a, b, a, a, a, a, a, b];
    const kMatrix = [
      [0, 0.329376383994, 0, 0, 0, 0, 0.417772178348, 0, 0.329376383994, 0, 0, 0, 0, 0.417772178348,
        0.658752767987],
      [0, 0.437791231086, 0, 0, 0, 0, 0, 0, 0.437791231086, 0, 0, 0.555282664941, 0.555282664941, 0, 0],
      [0, 0, 0.392644137855, 0, 0.392644137855, 0.392644137855, 0, 0, 0, 0, 0.392644137855, 0, 0, 0,
        0.61913029649],
      [0.5, 0, 0, 0.5, 0, 0, 0, 0.5, 0, 0.5, 0, 0, 0, 0, 0]
    ];
    const kNewPhrase = [0, 0, 0, 0, 0, 0, 0.535566272538, 0, 0, 0, 0, 0, 0, 0, 0.844493201701];

    const result = fitTfidf(phrases);

    it("has the same vocabulary and IDF", () => {
      expect(Array.from(result.vocabulary.keys())).toEqual(kVocabulary);
      expect(result.idf).toEqual(closeTo(kIdf, 14));
    });

    it("has the same matrix", () => {
      result.matrix.forEach((row, i) => expect(row).toEqual(closeTo(kMatrix[i], 11)));
    });

    it("vectorizes a new phrase the same way", () => {
      expect(vectorize(result, "the mat and the zebra")).toEqual(closeTo(kNewPhrase, 11));
    });
  });
});

describe("vectorize", () => {
  const phrases = ["the cat sat", "the dog sat", "a dog"];
  const model = fitTfidf(phrases);

  it("gives a phrase from the model the same row as the matrix", () => {
    phrases.forEach((phrase, i) => expect(vectorize(model, phrase)).toEqual(closeTo(model.matrix[i])));
  });

  it("ignores words that are not in the vocabulary", () => {
    expect(vectorize(model, "the zebra sat")).toEqual(closeTo(vectorize(model, "the sat")));
  });

  it("gives a phrase with no known word a row of zeros", () => {
    expect(vectorize(model, "zebras graze")).toEqual([0, 0, 0, 0]);
  });
});
