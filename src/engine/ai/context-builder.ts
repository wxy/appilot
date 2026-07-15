/**
 * Context Builder — Phase 0: single-repo System Prompt assembly.
 *
 * Builds the structured prompt injected into every AI call, ensuring
 * the AI has accurate, code-derived context about the project.
 */

import type { RepoSummary, FeatureHighlight } from "../repo-analyzer";

export interface AIContext {
  systemPrompt: string;
  repoSnapshot: RepoSummary;
  highlights: FeatureHighlight[];
}

export interface UserPreferences {
  tone?: string;          // "formal" | "casual" | "technical"
  emphasis?: string[];    // e.g. ["open-source", "performance"]
  bannedWords?: string[];
  extraInstructions?: string;
}

const DEFAULT_PREFS: UserPreferences = {};

/**
 * Build the AI System Prompt from a RepoSummary + optional user preferences.
 * Phase 0: single repo, Twitter-focused.
 */
export function buildContext(
  summary: RepoSummary,
  highlights: FeatureHighlight[],
  prefs: UserPreferences = DEFAULT_PREFS,
): AIContext {
  const lines: string[] = [
    "You are Appilot, an AI promotion assistant. Generate promotional content based on the project facts below.",
    "",
    "## Project",
    `- Name: ${summary.projectName}`,
    `- Tagline: ${summary.tagline}`,
    `- Description: ${summary.description || "N/A"}`,
    `- License: ${summary.license || "N/A"}`,
  ];

  // Tech stack
  if (summary.techStack.length > 0 && summary.techStack[0] !== "Unknown") {
    lines.push(`- Tech Stack: ${summary.techStack.join(", ")}`);
  }

  // Audience
  if (summary.inferredAudience) {
    lines.push(`- Target Audience: ${summary.inferredAudience}`);
  }

  // Key features
  if (highlights.length > 0) {
    lines.push("", "## Key Features");
    for (const h of highlights) {
      const label = h.source === "code_verified" ? "✅" : "⚠️";
      lines.push(`- ${label} ${h.title}: ${h.description}`);
    }
    lines.push("", "(✅ = verified from code, ⚠️ = AI inferred — verify before publishing)");
  }

  // Recent commits
  if (summary.recentCommits.length > 0) {
    lines.push("", "## Recent Activity");
    for (const c of summary.recentCommits) {
      lines.push(`- ${c.date.slice(0, 10)}: ${c.message}`);
    }
  }

  // Platform guidelines
  lines.push("", "## Platform: Twitter/X");
  lines.push("- Maximum 280 characters");
  lines.push("- Include 3–5 relevant hashtags");
  lines.push("- One clear link to the project (GitHub or website)");
  lines.push("- Tone: professional but approachable, speaks to developers");

  // User preferences
  if (prefs.tone) {
    lines.push(`- Preferred tone: ${prefs.tone}`);
  }
  if (prefs.emphasis && prefs.emphasis.length > 0) {
    lines.push(`- Emphasize: ${prefs.emphasis.join(", ")}`);
  }
  if (prefs.bannedWords && prefs.bannedWords.length > 0) {
    lines.push(`- Avoid these words/phrases: ${prefs.bannedWords.join(", ")}`);
  }
  if (prefs.extraInstructions) {
    lines.push(`- ${prefs.extraInstructions}`);
  }

  lines.push("", "Generate content that highlights what makes this project unique.");

  return {
    systemPrompt: lines.join("\n"),
    repoSnapshot: summary,
    highlights,
  };
}
