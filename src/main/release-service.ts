import { createStoreSubmissionDraft } from "../engine/store-submission";
import type { StoreSubmissionDraft } from "../engine/store-submission";
import { createAiProvider } from "./ai-service";
import { ensureProjectKeywordPool, getStoreSubmissionDrafts } from "./project-state";
import type { AppStore } from "./store";
import type { ReleaseInfo } from "../engine/release-watcher";

export interface ProjectLike {
  id: string;
  name: string;
  localPath: string;
  trackedKeywords?: any[];
  submissionKeywords?: any[];
  storeSubmissionDrafts?: any[];
}

export interface ProductLike {
  id: string;
  trackName?: string | null;
  platform?: string | null;
  supportedLanguages?: { code: string; name?: string }[];
  rankSnapshots?: any[];
  storeLinks?: any[];
}

/** Build the stable project-profile context block shared by AI tasks. */
export async function buildProjectProfileFor(
  project: ProjectLike,
  product: ProductLike,
  subtitle?: string,
  description?: string,
) {
  const [{ buildProjectProfile }, { readRepoDescription, readFullReadme }] = await Promise.all([
    import("../engine/project-profile"),
    import("../engine/app-store-discovery"),
  ]);
  const drafts = getStoreSubmissionDrafts(project)
    .filter((item: any) => item.productId === product.id)
    .sort((a: any, b: any) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  const releaseHistory = drafts.map((item: any) => ({
    tag: String(item.releaseTag || ""),
    name: item.appVersion ? `v${String(item.appVersion).replace(/^v/i, "")}` : null,
    summary: String(item.summary || ""),
    publishedAt: String(item.updatedAt || ""),
  })).filter((item: any) => item.tag);
  return buildProjectProfile({
    name: product.trackName || project.name,
    subtitle: subtitle ?? drafts[0]?.localizations?.[0]?.subtitle ?? null,
    platform: product.platform || null,
    supportedLanguages: (product.supportedLanguages || []).map((l: any) => l.code),
    description: description ?? readRepoDescription(project.localPath),
    readme: readFullReadme(project.localPath),
    storeLinks: product.storeLinks || [],
    trackedKeywords: ensureProjectKeywordPool(project).trackedKeywords || [],
    releaseHistory,
  });
}

/** Minimal release view reconstructed from a saved draft when git no longer
 *  surfaces the candidate (e.g. material is empty after generation). */
export function synthesizeReleaseFromDraft(draft: any): any {
  return {
    id: `draft-release-${draft.releaseTag}`,
    tag: draft.releaseTag,
    name: draft.appVersion ? `v${String(draft.appVersion).replace(/^v/i, "")}` : draft.releaseTag,
    publishedAt: draft.updatedAt || new Date().toISOString(),
    url: "",
    body: draft.summary || "",
    material: null,
    source: "git-tag",
    githubDraft: null,
    draft: true,
    commitSha: null,
  };
}

export async function generateStoreSubmissionDraft(
  store: AppStore,
  project: ProjectLike,
  product: ProductLike,
  release: ReleaseInfo,
  existingDraft: StoreSubmissionDraft | null,
  onProgress?: (event: any) => void,
  sourceLanguage?: string,
  appVersionOverride?: string,
  onChars?: (received: { chars: number; phase: "reasoning" | "content" }) => void,
  includedChanges?: string[],
): Promise<StoreSubmissionDraft> {
  const { generateStoreSubmissionContent } = await import("../engine/ai/release-reviewer");
  const { readRepoDescription } = await import("../engine/app-store-discovery");

  const provider = await createAiProvider(store);

  ensureProjectKeywordPool(project);
  const trackedKeywords: string[] = Array.from(
    new Set<string>(
      (project.trackedKeywords || []).map((keyword: any) => String(keyword?.keyword || "").trim()),
    ),
  ).filter(Boolean);
  const recentRankings = (product.rankSnapshots || []).slice(-20).map((snapshot: any) => ({
    keyword: snapshot.keyword,
    storefront: snapshot.storefront,
    rank: snapshot.rank,
    checkedAt: snapshot.checkedAt,
  }));
  const detectedLanguages = (product.supportedLanguages || [])
    .map((item: any) => String(item?.code || "").trim())
    .filter((code: string) => Boolean(code));
  const language = sourceLanguage || detectedLanguages[0] || "en";
  const previousDrafts = getStoreSubmissionDrafts(project)
    .filter((item) => item.productId === product.id && item.releaseTag !== release.tag)
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  const previousDraft = previousDrafts[0] || null;
  const previousLocalization = previousDraft?.localizations?.find(
    (item) => item.language === language,
  ) || previousDraft?.localizations?.[0] || undefined;

  onProgress?.({
    kind: "phase",
    phase: "read_readme",
    status: "started",
  });
  const description = readRepoDescription(project.localPath);
  onProgress?.({
    kind: "phase",
    phase: "read_readme",
    status: "completed",
    bytes: description.length || 0,
  });

  onProgress?.({
    kind: "phase",
    phase: "read_previous",
    status: "started",
  });
  const previousDescription = previousDraft?.description || "";
  onProgress?.({
    kind: "phase",
    phase: "read_previous",
    status: "completed",
    bytes: previousDescription.length || 0,
  });

  const profile = await buildProjectProfileFor(project, product, undefined, description);
  const content = await generateStoreSubmissionContent(
    provider,
    {
      name: product.trackName || project.name,
      description,
      language,
      trackedKeywords,
      currentSubmissionKeywords: project.submissionKeywords || [],
      recentRankings,
      release,
      reviewFeedback: existingDraft?.reviewFeedback || "",
      baseLocalization: existingDraft?.localizations?.[0],
      previousDescription,
      previousLocalization,
      profile,
      includedChanges,
    },
    onProgress,
    onChars,
  );

  const draft = createStoreSubmissionDraft({
    projectId: project.id,
    productId: product.id,
    release,
    content,
    existing: existingDraft,
  });
  if (appVersionOverride && appVersionOverride.trim()) {
    draft.appVersion = appVersionOverride.trim();
  }
  return draft;
}
