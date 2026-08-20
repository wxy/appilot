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
    .sort(
      (a, b) =>
        (a.bestRank ?? Number.POSITIVE_INFINITY) - (b.bestRank ?? Number.POSITIVE_INFINITY),
    )
    .slice(0, 30)
    .map((keyword) => String(keyword.keyword));

  return {
    name: input.name,
    subtitle: input.subtitle || null,
    platform: input.platform || null,
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
    `Supported languages: ${profile.languages.join(", ") || "N/A"}`,
    `Store links: ${profile.storeNames.join(", ") || "N/A"}`,
    `Storefront regions: ${profile.storefrontLabels.join(", ") || "N/A"}`,
    `Description: ${profile.description || "N/A"}`,
    `README (full):\n${profile.readme || "N/A"}`,
    `Tracked keywords (active, by best rank): ${profile.trackedKeywords.join(", ") || "N/A"}`,
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
