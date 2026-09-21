/**
 * Project profile — a stable, reusable context block shared by AI tasks.
 *
 * Contains the common, most-important facts about a product (identity,
 * description, languages, storefronts, active keyword coverage). Building it
 * from the same inputs always yields the same byte sequence, so it works as a
 * cache-friendly stable prefix: dynamic task-specific data goes AFTER it.
 */

export interface ProjectProfile {
  name: string;
  subtitle: string | null;
  platform: string | null;
  /** Other storefront products that belong to the same app/repository. */
  relatedPlatforms: string[];
  languages: string[];
  description: string;
  /** Full README content (stable, cache-friendly). */
  readme: string;
  storeNames: string[];
  storefrontLabels: string[];
  trackedKeywords: string[];
  /** Previous release announcements, newest first (reference context). */
  releaseHistory: {
    tag: string;
    name: string | null;
    summary: string;
    publishedAt: string;
  }[];
}

export interface ProjectProfileInput {
  name: string;
  subtitle?: string | null;
  platform?: string | null;
  relatedPlatforms?: string[];
  supportedLanguages: string[];
  description: string;
  readme?: string;
  storeLinks?: { name?: string | null; country?: string | null }[];
  trackedKeywords?: { keyword?: string; status?: string; bestRank?: number | null }[];
  releaseHistory?: {
    tag: string;
    name?: string | null;
    summary?: string;
    publishedAt?: string;
  }[];
}

/** Cap for the full README block; bounds prompt size while keeping the full text. */
export const PROJECT_README_MAX_CHARS = 30000;

export function buildProjectProfile(input: ProjectProfileInput): ProjectProfile {
  const active = (input.trackedKeywords || [])
    .filter((keyword) => keyword.status !== "paused" && keyword.keyword)
    // Stable byte order: rank-derived sorting would churn the cached prefix
    // every time a snapshot updates, defeating prompt caching.
    .sort((a, b) => String(a.keyword).localeCompare(String(b.keyword), "en"))
    .slice(0, 30)
    .map((keyword) => String(keyword.keyword));

  return {
    name: input.name,
    subtitle: input.subtitle || null,
    platform: input.platform || null,
    relatedPlatforms: [...new Set((input.relatedPlatforms || [])
      .map((item) => String(item || "").trim().toLowerCase())
      .filter((item) => item && item !== String(input.platform || "").trim().toLowerCase()))]
      .sort(),
    languages: [...(input.supportedLanguages || [])],
    description: input.description || "",
    storeNames: [
      ...new Set(
        (input.storeLinks || [])
          .map((link) => link.name)
          .filter((name): name is string => Boolean(name)),
      ),
    ],
    storefrontLabels: [
      ...new Set(
        (input.storeLinks || [])
          .map((link) => link.country)
          .filter((country): country is string => Boolean(country)),
      ),
    ],
    trackedKeywords: active,
    readme: (input.readme || "").slice(0, PROJECT_README_MAX_CHARS),
    releaseHistory: (input.releaseHistory || []).slice(0, 5).map((item) => ({
      tag: item.tag,
      name: item.name ?? null,
      summary: item.summary || "",
      publishedAt: item.publishedAt || "",
    })),
  };
}

/** Serialize the profile as a stable prompt block (prefix of user messages). */
export function profileToPromptBlock(profile: ProjectProfile): string {
  return [
    `App name: ${profile.name}`,
    `App subtitle: ${profile.subtitle || "N/A"}`,
    `Platform: ${profile.platform || "unknown"}`,
    `Related platforms: ${profile.relatedPlatforms.join(", ") || "N/A"}`,
    `Supported languages: ${profile.languages.join(", ") || "N/A"}`,
    `Store links: ${profile.storeNames.join(", ") || "N/A"}`,
    `Storefront regions: ${profile.storefrontLabels.join(", ") || "N/A"}`,
    `Description: ${profile.description || "N/A"}`,
    `README (full):\n${profile.readme || "N/A"}`,
    `Tracked keywords (active): ${profile.trackedKeywords.join(", ") || "N/A"}`,
    profile.releaseHistory.length > 0
      ? [
          "Recent release announcements (newest first):",
          ...profile.releaseHistory.map(
            (item) =>
              `- ${item.tag}${item.name && item.name !== item.tag ? ` (${item.name})` : ""}${item.publishedAt ? ` [${item.publishedAt}]` : ""}: ${item.summary || "(no summary)"}`,
          ),
        ].join("\n")
      : "Recent release announcements: N/A",
  ].join("\n");
}

/**
 * Platform boundary shared by release-copy and screenshot-copy generation.
 * Repository/release material can describe the whole product family, while an
 * App Store version and its screenshots belong to one storefront platform.
 */
export function platformCopyGuidance(profile?: ProjectProfile): string {
  const platform = String(profile?.platform || "").trim().toLowerCase();
  if (!platform) return "The target storefront platform is unknown. Do not assume that every cross-platform release item applies to this store product.";
  const target = platform === "ios"
    ? "iOS (iPhone and iPad)"
    : platform === "macos"
      ? "macOS"
      : platform;
  const related = (profile?.relatedPlatforms || []).join(", ") || "other supported platforms";
  return [
    `Target storefront platform: ${target}. Related storefront platforms: ${related}.`,
    "Treat the README, release announcement, and confirmed changes as cross-platform source material, not as proof that every item ships on the target platform.",
    "Prioritize capabilities and user-visible changes that apply to the target platform. Omit changes that are exclusive to another platform from this platform's description, promotional text, whatsNew, promotion angles, and screenshots.",
    "Other platforms may be mentioned only when the supplied evidence supports a real companion-app, synchronization, continuity, universal-purchase, or cross-platform relationship. Keep that mention secondary to the target-platform experience.",
    "The App Store name and subtitle are shared app-level identity fields: keep them platform-neutral and consistent across related platforms; do not add Mac, iPhone, iPad, or Watch wording merely to specialize this version.",
  ].join("\n");
}

/**
 * Byte-stable shared context block. Every AI request for a project starts with
 * this exact text, so OpenAI/DeepSeek automatic prefix caching can hit across
 * features. Task-specific instructions and volatile data must come AFTER it.
 */
export function archiveSystemPrompt(profile: ProjectProfile): string {
  return [
    "Appilot project archive (shared stable context for all tasks):",
    profileToPromptBlock(profile),
  ].join("\n\n");
}
