export interface KeywordSuggestion {
  language: string;
  keyword: string;
  rationale: string;
  translation: string;
}

export interface KeywordGeneration {
  tracking: KeywordSuggestion[];
}
