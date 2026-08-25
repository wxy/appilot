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
  /** 变更摘要中已由用户确认为覆盖的条目 id（用于 what's-new 覆盖核对）。 */
  summaryChecklist?: string[];
  createdAt: string;
  updatedAt: string;
}

export function githubStatusForRelease(release: ReleaseInfo): GitHubReleaseStatus {
  return release.draft ? "draft" : "published";
}

export function submissionDraftId(projectId: string, productId: string, releaseTag: string): string {
  return `${projectId}:${productId}:${releaseTag}`;
}

export function inferAppVersion(release: ReleaseInfo): string {
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
