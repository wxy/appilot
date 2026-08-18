import type { ReleaseInfo } from "./release-watcher";

export type AppStoreStatus =
  | "prepared"
  | "copied"
  | "submitted"
  | "in_review"
  | "rejected"
  | "released";

export type GitHubReleaseStatus = "draft" | "published";

export interface TrackingKeywordChange {
  language: string;
  keyword: string;
  direction: "add" | "remove";
  reason: string;
}

export interface StoreSubmissionLocalization {
  language: string;
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
  trackingKeywordDeltas: TrackingKeywordChange[];
  promotionAngles: string[];
}

export interface StoreSubmissionDraft extends StoreSubmissionContent {
  id: string;
  projectId: string;
  productId: string;
  releaseTag: string;
  sourceHash: string;
  appVersion: string;
  buildNumber: string;
  githubDraftStatus: GitHubReleaseStatus;
  storeStatus: AppStoreStatus;
  reviewFeedback: string;
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
  return release.tag.replace(/^v/i, "");
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
    trackingKeywordDeltas: input.content.trackingKeywordDeltas,
    promotionAngles: input.content.promotionAngles,
  };
}

export function shouldGenerateSubmission(release: ReleaseInfo): boolean {
  return release.draft;
}

export function isPublishedSignal(release: ReleaseInfo): boolean {
  return !release.draft;
}
