export function formatVersionDate(iso?: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return (
    date.toLocaleDateString("zh-CN", sameYear ? { month: "numeric", day: "numeric" } : { year: "numeric", month: "numeric", day: "numeric" }) +
    " " +
    date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })
  );
}

export function draftVersionLabel(item: any): string {
  // The user-confirmed App Store version wins over the git tag identity:
  // a draft may be keyed to the tag it was generated from while its content
  // targets a later store version.
  const version = String(item.appVersion || item.releaseTag || "");
  if (/^v?\d+(\.\d+)*$/.test(version)) return version.startsWith("v") ? version : `v${version}`;
  return formatVersionDate(item.updatedAt) || version || "未知版本";
}

/** Merge draft records that belong to the same release version (same releaseTag),
 *  consolidating their localizations by language so a version is never split
 *  into multiple rows because its languages were translated at different times. */
export function mergeHistoryDrafts(drafts: any[]): any[] {
  const byTag = new Map<string, any>();
  for (const draft of drafts) {
    const key = String(draft.releaseTag || draft.id || "");
    const existing = byTag.get(key);
    if (!existing) {
      byTag.set(key, { ...draft, localizations: [...(draft.localizations || [])] });
      continue;
    }
    const langs = new Map<string, any>(
      (existing.localizations || []).map((item: any) => [item.language, item]),
    );
    for (const loc of draft.localizations || []) {
      if (loc?.language) langs.set(loc.language, loc);
    }
    const next: any = { ...existing, localizations: [...langs.values()] };
    if (!next.updatedAt || new Date(draft.updatedAt).getTime() > new Date(next.updatedAt).getTime()) {
      next.updatedAt = draft.updatedAt;
    }
    next.summary = next.summary || draft.summary || "";
    byTag.set(key, next);
  }
  return [...byTag.values()].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  );
}
