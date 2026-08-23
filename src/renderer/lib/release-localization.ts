/** Resolve a submission draft into per-language localization objects (legacy drafts included). */
export function localizationList(draft: any): any[] {
  if (draft?.localizations?.length) return draft.localizations;
  return [
    {
      language: draft?.submissionKeywords?.[0]?.language || "en",
      name: draft?.name || "",
      subtitle: draft?.subtitle || "",
      promotionalText: draft?.promotionalText || "",
      description: draft?.description || "",
      whatsNew: draft?.whatsNew || "",
      keywords: draft?.submissionKeywords?.[0]?.text || "",
    },
  ];
}
