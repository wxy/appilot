/**
 * Pure helpers for the tracking-keyword matrix view.
 *
 * `language: "en"` is treated as GLOBAL keywords: they are tracked in every
 * storefront and shown in every language view with a "全局" badge.
 */

export function trackingLanguageOptions(
  supported: { code: string; name: string }[],
): { code: string; label: string }[] {
  const options = supported.map((language) =>
    language.code === "en"
      ? { code: "en", label: "全局" }
      : { code: language.code, label: language.name },
  );
  if (!supported.some((language) => language.code === "en")) {
    options.push({ code: "en", label: "全局" });
  }
  return options;
}

export function matrixFilterKeywords(
  keywords: { language: string }[],
  viewLang: string,
): { language: string }[] {
  return keywords.filter((keyword) => keyword.language === viewLang || keyword.language === "en");
}
