/**
 * AI Engine — Phase 0: product summary + Twitter tweet generation.
 *
 * Orchestrates RepoAnalyzer → ContextBuilder → AIProvider to produce
 * AI-generated promotion content driven by actual repository data.
 */

import type { RepoAnalyzer, RepoSummary, FeatureHighlight } from "../repo-analyzer";
import type { AIProvider, ChatMessage } from "./ai-provider";
import { buildContext, type UserPreferences } from "./context-builder";
import { EngineError, ApiError } from "../errors";
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

  /**
   * Analyze a repo and return a structured product summary.
   * Uses the repo data directly — no extra AI call needed for Phase 0
   * (the RepoAnalyzer already extracts all the structured data).
   */
  async analyzeProduct(repoUrl: string): Promise<ProductSummary> {
    log.info(`Analyzing product: ${repoUrl}`);

    const index = await this.analyzer.connectGitHubPublicRepo(repoUrl);
    const summary = await this.analyzer.summarize(index);
    const highlights = await this.analyzer.extractHighlights(index.repo);

    return {
      name: summary.projectName,
      tagline: summary.tagline,
      description: summary.description,
      techStack: summary.techStack,
      keyFeatures: highlights.map((h) => h.title),
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
    const index = await this.analyzer.connectGitHubPublicRepo(repoUrl);
    const summary = await this.analyzer.summarize(index);
    const highlights = await this.analyzer.extractHighlights(index.repo);

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

    // Extract hashtags
    const hashtagRegex = /#\w+/g;
    const hashtags = body.match(hashtagRegex)?.map((h) => h.toLowerCase()) || [];

    return {
      platform: "twitter",
      body,
      hashtags,
      characterCount: body.length,
    };
  }
}
