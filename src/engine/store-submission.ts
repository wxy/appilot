import type { ReleaseInfo } from "./release-watcher";

export type AppStoreStatus =
  | "prepared"
  | "copied"
  | "submitted"
  | "in_review"
  | "rejected"
  | "released";

export type GitHubReleaseStatus = "draft" | "published";

export interface StoreSubmissionLocalization {
  language: string;
  /** App Store 名称：建议「具体名称: 描述性短句」，≤30 字符。 */
  name: string;
  /** App Store 副标题，≤30 字符。 */
  subtitle: string;
  promotionalText: string;
  description: string;
  whatsNew: string;
  keywords: string;
}

export interface StoreSubmissionContent {
  summary: string;
  localizations: StoreSubmissionLocalization[];
  // Legacy single-language fields, kept for migration and fallback.
  promotionalText: string;
  whatsNew: string;
  description: string;
  submissionKeywords: { language: string; text: string }[];
  promotionAngles: string[];
}

export interface StoreSubmissionDraft extends StoreSubmissionContent {
  id: string;
  projectId: string;
  productId: string;
  /** 内容来源：生成该文案素材所用的 release（tag 或 gh-{id}）。不是身份。 */
  releaseTag: string;
  sourceHash: string;
  /** 目标版本：文案身份与 ASC 匹配键（一个版本一份文案，可手动修改）。 */
  appVersion: string;
  buildNumber: string;
  githubDraftStatus: GitHubReleaseStatus;
  storeStatus: AppStoreStatus;
  reviewFeedback: string;
  /** 母本语言已确定（锁定母本、允许翻译其他语言）的时间。 */
  masterConfirmedAt?: string;
  /** 整批多语言文案已确定（全部只读）的时间。 */
  batchConfirmedAt?: string;
  /** 上架后按商店实际文案回读覆盖本地快照的时间（冻结依据）。 */
  ascSyncedAt?: string;
  /** 无 ASC 凭证时，按商店公开信息（iTunes description/releaseNotes）部分冻结的时间。 */
  storeSyncedAt?: string;
  /** 变更摘要中已由用户确认为覆盖的条目 id（用于 what's-new 覆盖核对）。 */
  summaryChecklist?: string[];
  createdAt: string;
  updatedAt: string;
}

export interface AscLocalizationLike {
  locale: string;
  name?: string;
  subtitle?: string;
  promotionalText?: string;
  description?: string;
  whatsNew?: string;
  keywords?: string;
}

export function localeMatchesLocale(locale: string, code: string): boolean {
  const a = String(locale || "").toLowerCase();
  const b = String(code || "").toLowerCase();
  return Boolean(a && b) && (a === b || a.startsWith(b) || b.startsWith(a));
}

/**
 * Freeze a copy draft against the actual store copy (ASC localizations):
 * the store is the final truth once the version is live. Overwrites matching
 * language fields in place and stamps `ascSyncedAt`. Returns true when any
 * field changed. Languages in ASC without a draft match are left untouched.
 */
export function applyAscSnapshotToDraft(
  draft: StoreSubmissionDraft,
  ascLocalizations: AscLocalizationLike[],
  now = new Date().toISOString(),
): boolean {
  let changed = false;
  const fields = [
    "name",
    "subtitle",
    "promotionalText",
    "description",
    "whatsNew",
    "keywords",
  ] as const;
  for (const ascLoc of ascLocalizations) {
    const locale = String(ascLoc.locale || "").trim();
    if (!locale) continue;
    const match = (draft.localizations || []).find(
      (loc) =>
        localeMatchesLocale(locale, loc.language || "") ||
        ((loc as any).locale && localeMatchesLocale(locale, (loc as any).locale)),
    );
    if (!match) continue;
    for (const field of fields) {
      const raw = ascLoc[field];
      if (raw === undefined) continue;
      const value = String(raw);
      // ASC 返回的空字符串不代表商店实际为空：name/subtitle 等可选字段未在
      // 版本级设置时接口返回空，但商店实际显示 App 级名称。空值不覆盖本地。
      if (!value) continue;
      if (String((match as any)[field] || "") !== value) {
        (match as any)[field] = value;
        changed = true;
      }
    }
  }
  if (changed) {
    draft.ascSyncedAt = now;
    draft.updatedAt = now;
  }
  return changed;
}

export interface StorePublicCopyUpdate {
  language: string;
  description?: string;
  whatsNew?: string;
}

/**
 * Partial freeze without ASC credentials: align description and whats-new per
 * language using the public storefront copy (iTunes lookup). Name/subtitle/
 * keywords/promotional text are not confirmable this way and stay untouched.
 */
export function applyStorePublicSnapshotToDraft(
  draft: StoreSubmissionDraft,
  updates: StorePublicCopyUpdate[],
  now = new Date().toISOString(),
): boolean {
  let changed = false;
  for (const update of updates) {
    const language = String(update.language || "").trim();
    if (!language) continue;
    const match = (draft.localizations || []).find(
      (loc) =>
        localeMatchesLocale(language, loc.language || "") ||
        ((loc as any).locale && localeMatchesLocale(language, (loc as any).locale)),
    );
    if (!match) continue;
    if (update.description !== undefined && match.description !== update.description) {
      match.description = update.description;
      changed = true;
    }
    if (update.whatsNew !== undefined && match.whatsNew !== update.whatsNew) {
      match.whatsNew = update.whatsNew;
      changed = true;
    }
  }
  if (changed) {
    draft.storeSyncedAt = now;
    draft.updatedAt = now;
  }
  return changed;
}

export interface StoreRebuildInput {
  projectId: string;
  productId: string;
  releaseTag: string;
  appVersion: string;
  supportedLanguages: string[];
  /** 版本级 localizations（description/whatsNew/keywords/promotionalText）。 */
  versionLocalizations: AscLocalizationLike[];
  /** App 级 localizations（商店显示的名称/副标题）。 */
  appInfoLocalizations: AscLocalizationLike[];
  githubDraftStatus?: GitHubReleaseStatus;
  now?: string;
}

function localeToLanguage(locale: string, supportedLanguages: string[]): string {
  const normalized = String(locale || "").trim();
  if (!normalized) return "";
  const match = supportedLanguages.find((code) => localeMatchesLocale(normalized, code));
  return match || normalized;
}

/**
 * Rebuild a complete local copy draft from the actual store copy after local
 * drafts were lost (e.g. cleared and re-generated after the version went
 * live). Version-level localizations provide description/whats-new/keywords/
 * promotional text; App-level localizations provide the displayed
 * name/subtitle. The rebuilt draft is stamped as confirmed and store-synced.
 */
export function buildStoreRebuildDraft(input: StoreRebuildInput): StoreSubmissionDraft {
  const now = input.now || new Date().toISOString();
  const appInfoByLocale = new Map(
    (input.appInfoLocalizations || []).map((loc) => [String(loc.locale || "").toLowerCase(), loc]),
  );
  const localizations: StoreSubmissionLocalization[] = [];
  for (const versionLoc of input.versionLocalizations || []) {
    const locale = String(versionLoc.locale || "").trim();
    if (!locale) continue;
    const language = localeToLanguage(locale, input.supportedLanguages || []);
    const appInfo = appInfoByLocale.get(locale.toLowerCase()) || null;
    localizations.push({
      language,
      name: appInfo?.name || versionLoc.name || "",
      subtitle: appInfo?.subtitle || versionLoc.subtitle || "",
      promotionalText: versionLoc.promotionalText || "",
      description: versionLoc.description || "",
      whatsNew: versionLoc.whatsNew || "",
      keywords: versionLoc.keywords || "",
    });
  }
  const primary = localizations[0] || null;
  return {
    id: submissionDraftId(input.projectId, input.productId, input.releaseTag),
    projectId: input.projectId,
    productId: input.productId,
    releaseTag: input.releaseTag,
    sourceHash: "",
    appVersion: String(input.appVersion || "").trim().replace(/^v/i, ""),
    buildNumber: "",
    githubDraftStatus: input.githubDraftStatus || "draft",
    storeStatus: "released",
    reviewFeedback: "",
    masterConfirmedAt: now,
    batchConfirmedAt: now,
    ascSyncedAt: now,
    summary: "按商店实际文案重建（App Store）",
    localizations,
    promotionalText: primary?.promotionalText || "",
    whatsNew: primary?.whatsNew || "",
    description: primary?.description || "",
    submissionKeywords: localizations.map((item) => ({
      language: item.language,
      text: item.keywords,
    })),
    promotionAngles: [],
    createdAt: now,
    updatedAt: now,
  };
}

export function githubStatusForRelease(release: ReleaseInfo): GitHubReleaseStatus {
  return release.draft ? "draft" : "published";
}

export function submissionDraftId(projectId: string, productId: string, releaseTag: string): string {
  return `${projectId}:${productId}:${releaseTag}`;
}

export function inferAppVersion(release: { tag: string; name?: string | null }): string {
  const tag = String(release.tag || "").trim();
  if (/^v?\d+(\.\d+)*$/.test(tag)) return tag.replace(/^v/i, "");
  // GitHub release drafts may have no tag yet (tag = `gh-{id}` fallback).
  // Fall back to the release name when it carries a semantic version, e.g.
  // "v1.1.1" or "GloWalk 1.1.1 WIP".
  const name = String(release.name || "").trim();
  // Require a dotted version to avoid matching years/PR numbers ("2026", "v2").
  const match = name.match(/(?:^|\s)v?(\d+\.\d+(?:\.\d+)*)/);
  if (match) return match[1];
  return "";
}

export function releaseFingerprint(release: ReleaseInfo): string {
  return [
    release.tag,
    release.name || "",
    release.body || "",
    release.publishedAt || "",
  ].join("\u0000");
}

export function createStoreSubmissionDraft(input: {
  projectId: string;
  productId: string;
  release: ReleaseInfo;
  content: StoreSubmissionContent;
  existing?: StoreSubmissionDraft | null;
}): StoreSubmissionDraft {
  const now = new Date().toISOString();
  const existing = input.existing || null;
  return {
    id: submissionDraftId(input.projectId, input.productId, input.release.tag),
    projectId: input.projectId,
    productId: input.productId,
    releaseTag: input.release.tag,
    sourceHash: releaseFingerprint(input.release),
    appVersion: inferAppVersion(input.release),
    buildNumber: "",
    githubDraftStatus: githubStatusForRelease(input.release),
    storeStatus: existing?.storeStatus || "prepared",
    reviewFeedback: existing?.reviewFeedback || "",
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    summary: input.content.summary,
    localizations: input.content.localizations,
    promotionalText: input.content.promotionalText,
    whatsNew: input.content.whatsNew,
    description: input.content.description,
    submissionKeywords: input.content.submissionKeywords,
    promotionAngles: input.content.promotionAngles,
  };
}

export function shouldGenerateSubmission(release: ReleaseInfo): boolean {
  return release.draft;
}

export function isPublishedSignal(release: ReleaseInfo): boolean {
  return !release.draft;
}
