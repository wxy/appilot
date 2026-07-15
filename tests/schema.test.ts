/**
 * Phase 0 Schema Verification Test
 *
 * Creates a temp SQLite database, runs migrations, and verifies:
 * 1. All 5 tables exist
 * 2. Foreign key relationships work
 * 3. Basic CRUD operations succeed
 *
 * Run: npx tsx tests/schema.test.ts
 */

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { runMigrations } from "../src/engine/database/migrate";
import * as schema from "../src/engine/database/schema";
import { eq } from "drizzle-orm";

const sqlite = new Database(":memory:");
runMigrations(sqlite);
const db = drizzle(sqlite, { schema });

let errors = 0;

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`❌ FAIL: ${msg}`);
    errors++;
  } else {
    console.log(`✅ PASS: ${msg}`);
  }
}

// 1. Verify all 5 tables exist
const tables = sqlite
  .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
  .all() as { name: string }[];

const tableNames = tables.map((t) => t.name);
assert(tableNames.includes("ai_config"), "ai_config table exists");
assert(tableNames.includes("projects"), "projects table exists");
assert(tableNames.includes("posts"), "posts table exists");
assert(tableNames.includes("post_analytics"), "post_analytics table exists");
assert(tableNames.includes("ai_actions"), "ai_actions table exists");

// 2. Insert a project
const project = db
  .insert(schema.projects)
  .values({ name: "TestApp", repoUrl: "github.com/test/testapp" })
  .returning()
  .get();

assert(!!project, "Can insert a project");

// 3. Insert AI config
const config = db
  .insert(schema.aiConfig)
  .values({ providerUrl: "https://api.openai.com/v1", apiKey: "sk-test", modelName: "gpt-4o" })
  .returning()
  .get();

assert(!!config, "Can insert AI config");

// 4. Insert a post (depends on project FK)
const post = db
  .insert(schema.posts)
  .values({
    projectId: project.id,
    title: "Test tweet",
    body: "Hello world #test",
    status: "published",
    permalink: "https://twitter.com/test/status/123",
  })
  .returning()
  .get();

assert(!!post && post.projectId === project.id, "Can insert a post with FK to project");

// 5. Insert post analytics (depends on post FK)
const analytics = db
  .insert(schema.postAnalytics)
  .values({ postId: post.id, viewCount: 100, likeCount: 10, commentCount: 2 })
  .returning()
  .get();

assert(!!analytics && analytics.postId === post.id, "Can insert analytics with FK to post");

// 6. Insert AI action (depends on project FK)
const action = db
  .insert(schema.aiActions)
  .values({
    projectId: project.id,
    actionType: "analyze_product",
    promptTokens: 500,
    completionTokens: 200,
    estimatedCost: 0.01,
  })
  .returning()
  .get();

assert(!!action && action.actionType === "analyze_product", "Can insert AI action with FK to project");

// 7. Query back
const posts = db.select().from(schema.posts).all();
assert(posts.length === 1, "Can query posts");

const analyticsRows = db.select().from(schema.postAnalytics).all();
assert(analyticsRows.length === 1, "Can query analytics");

// 8. Verify cascade delete
db.delete(schema.projects).where(eq(schema.projects.id, project.id)).run();
const postsAfter = db.select().from(schema.posts).where(eq(schema.posts.id, post.id)).all();
assert(postsAfter.length === 0, "CASCADE delete removes dependent posts");

console.log(`\n${errors === 0 ? "🎉 All tests passed!" : `❌ ${errors} test(s) failed`}`);
process.exit(errors > 0 ? 1 : 0);
