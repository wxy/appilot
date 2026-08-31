export const STOREFRONTS_BY_LANGUAGE: Record<string, string[]> = {
  en: ["us", "gb", "au", "ca", "nz", "ie"],
  de: ["de", "at", "ch"],
  fr: ["fr", "ca", "be", "ch"],
  es: ["es", "mx", "ar", "cl"],
  it: ["it"],
  nl: ["nl", "be"],
  pt: ["br", "pt"],
  "pt-BR": ["br", "pt"],
  ja: ["jp"],
  ko: ["kr"],
  "zh-Hans": ["cn", "sg"],
  "zh-Hant": ["tw", "hk", "mo"],
  ru: ["ru"],
};

export const STOREFRONT_NAMES: Record<string, string> = {
  us: "美国",
  gb: "英国",
  au: "澳大利亚",
  ca: "加拿大",
  nz: "新西兰",
  ie: "爱尔兰",
  de: "德国",
  at: "奥地利",
  ch: "瑞士",
  fr: "法国",
  be: "比利时",
  es: "西班牙",
  mx: "墨西哥",
  ar: "阿根廷",
  cl: "智利",
  it: "意大利",
  nl: "荷兰",
  br: "巴西",
  pt: "葡萄牙",
  jp: "日本",
  kr: "韩国",
  cn: "中国大陆",
  sg: "新加坡",
  tw: "台湾",
  hk: "香港",
  mo: "澳门",
  ru: "俄罗斯",
};

export const ALL_STOREFRONT_CODES = Object.keys(STOREFRONT_NAMES);

const LANGUAGE_PRIORITY = [
  "en",
  "zh-Hans",
  "zh-Hant",
  "ja",
  "ko",
  "de",
  "fr",
  "es",
  "it",
  "nl",
  "pt",
  "pt-BR",
  "ru",
];

export function sortLanguageCodes(codes: string[]): string[] {
  const priority = new Map(LANGUAGE_PRIORITY.map((code, index) => [code, index]));
  return [...codes].sort((a, b) => {
    const aPriority = priority.has(a) ? priority.get(a)! : Number.MAX_SAFE_INTEGER;
    const bPriority = priority.has(b) ? priority.get(b)! : Number.MAX_SAFE_INTEGER;
    if (aPriority !== bPriority) return aPriority - bPriority;
    return a.localeCompare(b);
  });
}

export function storefrontsForLanguage(language: string): string[] {
  return STOREFRONTS_BY_LANGUAGE[language] || ["us"];
}

export function isStorefrontAllowedForQueryLanguage(
  queryLanguage: string,
  storefront: string,
): boolean {
  if (queryLanguage === "en") return ALL_STOREFRONT_CODES.includes(storefront.toLowerCase());
  return storefrontsForLanguage(queryLanguage).includes(storefront.toLowerCase());
}

export function defaultStorefrontForLanguage(language: string): string {
  return storefrontsForLanguage(language)[0] || "us";
}

export function storefrontDisplayName(country: string): string {
  return STOREFRONT_NAMES[country.toLowerCase()] || country.toUpperCase();
}
