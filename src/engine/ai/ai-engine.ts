/**
 * AI Engine — Phase 0: product summary + Twitter tweet generation.
 *
 * Orchestrates RepoAnalyzer → ContextBuilder → AIProvider to produce
 * AI-generated promotion content driven by actual repository data.
 */

import type { RepoAnalyzer, RepoSummary, FeatureHighlight } from "../repo-analyzer";
import type { AIProvider, ChatMessage } from "./ai-provider";
import { buildContext, type UserPreferences } from "./context-builder";
import { log } from "../logger";

export interface ProductSummary {
  name: string;
  tagline: string;
  description: string;
  techStack: string[];
  keyFeatures: string[];
  audience: string | null;
}

export type PromotionStage =
  | "launch"
  | "feature_update"
  | "tech_share"
  | "tutorial"
  | "milestone";

export interface GeneratedPost {
  platform: string;
  body: string;
  hashtags: string[];
  characterCount: number;
}

export interface AnalysisResult {
  tagline?: string;
  description?: string;
  features: string[];
}

/**
 * Parse the AI's structured analysis response. The prompt asks the model to
 * reply in a fixed `TAGLINE / DESCRIPTION / FEATURES` format; this parser is
 * tolerant of minor deviations so a bad response degrades gracefully.
 */
export function parseAnalysisResponse(raw: string): AnalysisResult {
  const lines = raw.split("\n").map((l) => l.trim());
  let tagline: string | undefined;
  let description: string | undefined;
  const features: string[] = [];
  let inFeatures = false;

  for (const line of lines) {
    if (/^tagline\s*:/i.test(line)) {
      const v = line.replace(/^tagline\s*:/i, "").trim();
      if (v) tagline = v;
    } else if (/^description\s*:/i.test(line)) {
      const v = line.replace(/^description\s*:/i, "").trim();
      if (v) description = v;
    } else if (/^features\s*:/i.test(line)) {
      inFeatures = true;
    } else if (inFeatures && /^[-•*]\s+/.test(line)) {
      const v = line.replace(/^[-•*]\s+/, "").trim();
      if (v) features.push(v);
    }
  }

  return { tagline, description, features: features.slice(0, 6) };
}

// ── AIEngine ──

export class AIEngine {
  private analyzer: RepoAnalyzer;
  private provider: AIProvider;
  private prefs: UserPreferences;

  constructor(analyzer: RepoAnalyzer, provider: AIProvider, prefs?: UserPreferences) {
    this.analyzer = analyzer;
    this.provider = provider;
    this.prefs = prefs || {};
  }

  async analyzeProduct(repoUrl: string): Promise<ProductSummary> {
    log.info(`Analyzing product: ${repoUrl}`);

    const summary = await this.getRepoSummary(repoUrl);

    // Enrich the heuristic summary with real AI analysis. On AI failure we
    // fall back to the heuristic tagline/description (features stay empty).
    let tagline = summary.tagline;
    let description = summary.description;
    let keyFeatures: string[] = [];

    try {
      const enriched = await this.analyzeWithAI(summary);
      tagline = enriched.tagline || tagline;
      description = enriched.description || description;
      keyFeatures = enriched.features;
    } catch (err: any) {
      log.warn(`AI enrichment failed for ${repoUrl}: ${err.message}`);
    }

    return {
      name: summary.projectName,
      tagline,
      description,
      techStack: summary.techStack,
      keyFeatures,
      audience: summary.inferredAudience,
    };
  }

  /**
   * Generate a tweet for a project at a given promotion stage.
   * Calls the AI with context assembled from the repo.
   */
  async generateTweet(repoUrl: string, stage: PromotionStage): Promise<GeneratedPost> {
    log.info(`Generating tweet for ${repoUrl} [${stage}]`);

    // 1. Get repo data
    const summary = await this.getRepoSummary(repoUrl);
    const highlights = await this.getHighlights(summary);

    // 2. Build context
    const ctx = buildContext(summary, highlights, this.prefs);

    // 3. Build stage-specific user prompt
    const stagePrompt = this.getStagePrompt(stage);

    // 4. Call AI
    const messages: ChatMessage[] = [
      { role: "system", content: ctx.systemPrompt },
      { role: "user", content: stagePrompt },
    ];

    const raw = await this.provider.chat(messages, { temperature: 0.8, maxTokens: 300 });

    // 5. Post-process
    return this.parseTweet(raw);
  }

  /** Get the raw RepoSummary for the Settings/Setup UI cache. */
  async getRepoSummary(repoUrl: string): Promise<RepoSummary> {
    const index = await this.analyzer.connectGitHubPublicRepo(repoUrl);
    return this.analyzer.summarize(index);
  }

  /** Extract AI-inferred feature highlights, falling back to [] on failure. */
  private async getHighlights(summary: RepoSummary): Promise<FeatureHighlight[]> {
    try {
      const enriched = await this.analyzeWithAI(summary);
      return enriched.features.map((title) => ({
        title,
        description: "",
        source: "ai_inferred" as const,
        isFocused: false,
      }));
    } catch (err: any) {
      log.warn(`Feature extraction failed: ${err.message}`);
      return [];
    }
  }

  /** Call the AI to refine the summary and extract key features. */
  private async analyzeWithAI(summary: RepoSummary): Promise<AnalysisResult> {
    const messages: ChatMessage[] = [
      {
        role: "system",
        content:
          "You are Appilot's product analyst. Extract accurate, concrete information about a project from the repository facts provided. Respond ONLY in the requested format, with no extra commentary.",
      },
      { role: "user", content: this.buildAnalysisPrompt(summary) },
    ];

    const raw = await this.provider.chat(messages, { temperature: 0.3, maxTokens: 400 });
    return parseAnalysisResponse(raw);
  }

  private buildAnalysisPrompt(summary: RepoSummary): string {
    const lines = [
      "Analyze this project and return structured info in the exact format below.",
      "",
      "Repository facts:",
      `- Name: ${summary.projectName}`,
      `- Tagline: ${summary.tagline}`,
      `- Description: ${summary.description || "N/A"}`,
      `- Tech stack: ${summary.techStack.join(", ")}`,
      `- License: ${summary.license || "N/A"}`,
      `- Audience: ${summary.inferredAudience || "unknown"}`,
    ];
    if (summary.recentCommits.length > 0) {
      const commitMsgs = summary.recentCommits.map((c) => c.message).join("; ");
      lines.push(`- Recent activity: ${commitMsgs}`);
    }
    lines.push(
      "",
      "Respond EXACTLY in this format:",
      "TAGLINE: <one line, max 15 words>",
      "DESCRIPTION: <1-2 sentences>",
      "FEATURES:",
      "- <feature 1>",
      "- <feature 2>",
      "- <feature 3>",
      "(list 3-6 concrete, differentiating features)",
      "",
      "Do not add any other text.",
    );
    return lines.join("\n");
  }

  // ── Private ──

  private getStagePrompt(stage: PromotionStage): string {
    const prompts: Record<PromotionStage, string> = {
      launch:
        "Write a launch announcement tweet. Highlight the key innovation and include a link. Keep under 280 chars.",
      feature_update:
        "Write a tweet announcing a new feature/update. Mention what changed and why it matters. Under 280 chars.",
      tech_share:
        "Write a technical tweet sharing an interesting implementation detail or design decision. Appeal to developers. Under 280 chars.",
      tutorial:
        "Write a tweet promoting a tutorial or guide. Mention the problem it solves. Under 280 chars.",
      milestone:
        "Write a milestone celebration tweet (stars, downloads, release). Express gratitude. Under 280 chars.",
    };
    return prompts[stage] || prompts.launch;
  }

  private parseTweet(raw: string): GeneratedPost {
    // Trim to a reasonable max
    const body = raw.trim().slice(0, 300);

    const hashtagRegex = /(?:^|\s)(#\w+)/g;
    const hashtags = [...body.matchAll(hashtagRegex)].map((m) => m[1].toLowerCase());

    return {
      platform: "twitter",
      body,
      hashtags,
      characterCount: body.length,
    };
  }
}
