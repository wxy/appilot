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
  const tag = String(item.releaseTag || item.appVersion || "");
  if (/^v?\d+(\.\d+)*$/.test(tag)) return tag.startsWith("v") ? tag : `v${tag}`;
  return formatVersionDate(item.updatedAt) || tag || "未知版本";
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
