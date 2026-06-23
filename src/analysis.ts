export type KeywordMatch = {
  keyword: string;
  count: number;
  importance: number;
  strength: number;
};

export type AtsAnalysis = {
  score: number;
  matchedKeywords: KeywordMatch[];
  missingKeywords: KeywordMatch[];
  resumeWordCount: number;
  jobWordCount: number;
  coverage: number;
  density: number;
  formatScore: number;
  roleSignals: string[];
};

const STOP_WORDS = new Set([
  "a",
  "about",
  "above",
  "after",
  "again",
  "against",
  "all",
  "also",
  "am",
  "an",
  "and",
  "any",
  "are",
  "as",
  "at",
  "be",
  "because",
  "been",
  "before",
  "being",
  "below",
  "between",
  "both",
  "but",
  "by",
  "can",
  "did",
  "do",
  "does",
  "doing",
  "down",
  "during",
  "each",
  "few",
  "for",
  "from",
  "further",
  "had",
  "has",
  "have",
  "having",
  "he",
  "her",
  "here",
  "hers",
  "herself",
  "him",
  "himself",
  "his",
  "how",
  "i",
  "if",
  "in",
  "into",
  "is",
  "it",
  "its",
  "itself",
  "just",
  "me",
  "more",
  "most",
  "my",
  "myself",
  "no",
  "nor",
  "not",
  "now",
  "of",
  "off",
  "on",
  "once",
  "only",
  "or",
  "other",
  "our",
  "ours",
  "ourselves",
  "out",
  "over",
  "own",
  "same",
  "she",
  "should",
  "so",
  "some",
  "such",
  "than",
  "that",
  "the",
  "their",
  "theirs",
  "them",
  "themselves",
  "then",
  "there",
  "these",
  "they",
  "this",
  "those",
  "through",
  "to",
  "too",
  "under",
  "until",
  "up",
  "very",
  "was",
  "we",
  "were",
  "what",
  "when",
  "where",
  "which",
  "while",
  "who",
  "whom",
  "why",
  "with",
  "you",
  "your",
  "yours",
  "yourself",
  "yourselves"
]);

const SECTION_SIGNALS = [
  "experience",
  "education",
  "skills",
  "projects",
  "certifications",
  "summary",
  "achievements"
];

const GENERIC_JOB_WORDS = new Set([
  "ability",
  "able",
  "across",
  "applicant",
  "applicants",
  "apply",
  "based",
  "benefits",
  "candidate",
  "candidates",
  "company",
  "degree",
  "description",
  "duties",
  "employment",
  "equal",
  "excellent",
  "fast",
  "including",
  "job",
  "knowledge",
  "looking",
  "minimum",
  "opportunity",
  "preferred",
  "qualifications",
  "required",
  "requirements",
  "responsibilities",
  "responsible",
  "role",
  "salary",
  "skills",
  "strong",
  "team",
  "teams",
  "work",
  "working",
  "years"
]);

const normalize = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9+#.\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const wordsFrom = (text: string) =>
  normalize(text)
    .split(" ")
    .filter((word) => word.length > 2 && !STOP_WORDS.has(word));

const countOccurrences = (haystack: string, needle: string) => {
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return (haystack.match(new RegExp(`\\b${escaped}\\b`, "gi")) ?? []).length;
};

const wordSetFrom = (text: string) => new Set(wordsFrom(text));

const matchKeyword = (normalizedResume: string, resumeWords: Set<string>, keyword: string) => {
  const exactCount = countOccurrences(normalizedResume, keyword);

  if (exactCount > 0) {
    return {
      count: exactCount,
      strength: 1
    };
  }

  const phraseWords = wordsFrom(keyword);

  if (phraseWords.length <= 1) {
    return {
      count: 0,
      strength: 0
    };
  }

  const matchedWords = phraseWords.filter((word) => resumeWords.has(word)).length;
  const strength = matchedWords / phraseWords.length;

  return {
    count: strength >= 0.6 ? 1 : 0,
    strength: strength >= 0.6 ? strength * 0.82 : strength * 0.35
  };
};

const tokenizedWordsFrom = (text: string) =>
  normalize(text)
    .split(" ")
    .filter((word) => word.length > 1);

const isUsefulPhrase = (tokens: string[]) => {
  const first = tokens[0];
  const last = tokens[tokens.length - 1];
  const meaningfulTokens = tokens.filter(
    (token) => !STOP_WORDS.has(token) && !GENERIC_JOB_WORDS.has(token)
  );

  return (
    meaningfulTokens.length >= 2 &&
    !STOP_WORDS.has(first) &&
    !STOP_WORDS.has(last) &&
    !GENERIC_JOB_WORDS.has(first) &&
    !GENERIC_JOB_WORDS.has(last)
  );
};

const dynamicPhrasesFromJob = (jobText: string) => {
  const tokens = tokenizedWordsFrom(jobText);
  const phraseCounts = new Map<string, number>();

  [2, 3].forEach((size) => {
    for (let index = 0; index <= tokens.length - size; index += 1) {
      const phraseTokens = tokens.slice(index, index + size);

      if (!isUsefulPhrase(phraseTokens)) {
        continue;
      }

      const phrase = phraseTokens.join(" ");
      phraseCounts.set(phrase, (phraseCounts.get(phrase) ?? 0) + 1);
    }
  });

  return [...phraseCounts.entries()]
    .map(([keyword, count]) => {
      const lengthBoost = keyword.split(" ").length;
      const hasTechnicalSignal = /[+#.]|\b(api|sql|react|node|python|aws|azure|crm|seo|ui|ux)\b/.test(
        keyword
      );

      return {
        keyword,
        importance: count * lengthBoost + (hasTechnicalSignal ? 2 : 0)
      };
    })
    .sort((a, b) => b.importance - a.importance || a.keyword.localeCompare(b.keyword))
    .slice(0, 22);
};

const topTermsFromJob = (jobText: string) => {
  const words = wordsFrom(jobText);
  const counts = new Map<string, number>();

  words.forEach((word) => counts.set(word, (counts.get(word) ?? 0) + 1));

  const phraseMatches = dynamicPhrasesFromJob(jobText);

  const singleTerms = [...counts.entries()]
    .map(([keyword, count]) => ({ keyword, importance: count }))
    .filter(({ keyword }) => !STOP_WORDS.has(keyword) && !GENERIC_JOB_WORDS.has(keyword))
    .sort((a, b) => b.importance - a.importance || a.keyword.localeCompare(b.keyword))
    .slice(0, 42);

  const merged = new Map<string, number>();
  [...phraseMatches, ...singleTerms].forEach(({ keyword, importance }) => {
    merged.set(keyword, Math.max(merged.get(keyword) ?? 0, importance));
  });

  return [...merged.entries()]
    .map(([keyword, importance]) => ({ keyword, importance }))
    .sort((a, b) => b.importance - a.importance || a.keyword.localeCompare(b.keyword))
    .slice(0, 36);
};

export const analyzeResume = (resumeText: string, jobText: string): AtsAnalysis => {
  const normalizedResume = normalize(resumeText);
  const resumeWords = wordsFrom(resumeText);
  const resumeWordSet = wordSetFrom(resumeText);
  const jobWords = wordsFrom(jobText);
  const keywords = topTermsFromJob(jobText);

  const keywordResults = keywords.map(({ keyword, importance }) => {
    const match = matchKeyword(normalizedResume, resumeWordSet, keyword);

    return {
      keyword,
      importance,
      count: match.count,
      strength: match.strength
    };
  });

  const matchedKeywords = keywordResults.filter((item) => item.strength >= 0.55);
  const missingKeywords = keywordResults.filter((item) => item.strength < 0.55);
  const possibleWeight = keywordResults.reduce((sum, item) => sum + item.importance, 0) || 1;
  const matchedWeight = keywordResults.reduce(
    (sum, item) => sum + item.importance * item.strength,
    0
  );
  const coverage = matchedWeight / possibleWeight;

  const densityHits = matchedKeywords.reduce(
    (sum, item) => sum + Math.max(item.strength, Math.min(item.count, 4)),
    0
  );
  const density = Math.min(1, densityHits / Math.max(10, keywords.length));

  const foundSections = SECTION_SIGNALS.filter((section) =>
    normalizedResume.includes(section)
  );
  const hasContactSignal = /@|linkedin|github|portfolio|phone/.test(normalizedResume);
  const hasMetricSignal = /\b\d+%|\b\d+\+|\$\d+|\b\d+x\b/.test(normalizedResume);
  const formatScore =
    Math.min(1, foundSections.length / 5) * 0.55 +
    (hasContactSignal ? 0.2 : 0) +
    (hasMetricSignal ? 0.25 : 0);

  const matchedKeywordRatio = matchedKeywords.length / Math.max(1, keywords.length);
  const score = Math.round(
    Math.min(
      100,
      coverage * 54 + matchedKeywordRatio * 18 + density * 12 + formatScore * 16
    )
  );

  return {
    score,
    matchedKeywords,
    missingKeywords,
    resumeWordCount: resumeWords.length,
    jobWordCount: jobWords.length,
    coverage,
    density,
    formatScore,
    roleSignals: foundSections
  };
};

export const fallbackResumeText = (fileName: string) =>
  `Could not extract readable text from ${fileName}. Try exporting the resume as a text-based PDF instead of a scanned image.`;
