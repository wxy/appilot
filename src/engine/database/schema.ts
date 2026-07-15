import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

// ── Phase 0 Tables (5) ──

/**
 * Global AI provider configuration (single row).
 * Phase 0: api_key stored in plaintext — Phase 1 migrates to safeStorage.
 */
export const aiConfig = sqliteTable("ai_config", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  providerUrl: text("provider_url").notNull().default("https://api.openai.com/v1"),
  apiKey: text("api_key").notNull().default(""),
  modelName: text("model_name").notNull().default("gpt-4o"),
  userPreferences: text("user_preferences"), // JSON: { tone?, bannedWords?, extraInstructions? }
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

/**
 * A project = one GitHub public repo + its AI analysis cache.
 * Phase 0: single project, single repo, source always "github_public".
 */
export const projects = sqliteTable("projects", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  status: text("status").notNull().default("pre_launch"), // pre_launch | launched | maintenance
  repoUrl: text("repo_url").notNull(), // e.g. github.com/user/repo
  repoSource: text("repo_source").notNull().default("github_public"), // Phase 0: always github_public
  aiProductSummary: text("ai_product_summary"), // JSON cache
  aiSummaryGeneratedAt: text("ai_summary_generated_at"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

/**
 * A published (or draft) post. Phase 0: platform always "twitter", publish_mode always "web_intent".
 */
export const posts = sqliteTable("posts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  projectId: integer("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  platform: text("platform").notNull().default("twitter"),
  title: text("title").notNull(),
  body: text("body").notNull(),
  platformPostId: text("platform_post_id"), // empty until user backfills
  permalink: text("permalink"), // user backfills the tweet URL
  publishMode: text("publish_mode").notNull().default("web_intent"), // Phase 0: always web_intent
  status: text("status").notNull().default("draft"), // draft | published
  publishedAt: text("published_at"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

/**
 * Time-series analytics snapshots per post.
 * Phase 0: source always "manual" (user-entered). source values "api" / "url_backfill" reserved for Phase 1+.
 */
export const postAnalytics = sqliteTable("post_analytics", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  postId: integer("post_id")
    .notNull()
    .references(() => posts.id, { onDelete: "cascade" }),
  platform: text("platform").notNull().default("twitter"),
  viewCount: integer("view_count"),
  likeCount: integer("like_count"),
  commentCount: integer("comment_count"),
  shareCount: integer("share_count"),
  source: text("source").notNull().default("manual"), // Phase 0: always manual
  note: text("note"), // user notes
  fetchedAt: text("fetched_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

/**
 * Audit log for every AI call — persists token usage and cost for the AI Usage Dashboard (Task 0.15).
 */
export const aiActions = sqliteTable("ai_actions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  projectId: integer("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  actionType: text("action_type").notNull(), // analyze_product | generate_tweet | generate_reply
  inputContext: text("input_context"), // System Prompt snapshot (repo summary sent to AI)
  outputContent: text("output_content"), // AI response
  promptTokens: integer("prompt_tokens"),
  completionTokens: integer("completion_tokens"),
  estimatedCost: real("estimated_cost"), // USD
  userModified: integer("user_modified").default(0), // boolean: 0/1
  platformPostId: text("platform_post_id"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});
