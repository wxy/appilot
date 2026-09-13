import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { openStore } from "@appilot-labs/appilot-headless";
import { resolveBriefRankData } from "../src/main/brief-rank-data";

const dir = mkdtempSync(path.join(os.tmpdir(), "appilot-brief-rank-"));
const store = openStore(path.join(dir, "app.db"));
const checkedAt = new Date().toISOString();
store.projects.save({
  name: "demo", id: "demo", path: "/tmp/demo", githubUrl: null,
  platform: "ios", languages: ["en"], lastResolvedAt: checkedAt,
  artworkUrl: null, updatedAt: checkedAt,
});
store.products.upsert({
  projectName: "demo", productId: "demo:ios", platform: "ios",
  trackId: null, bundleId: null, trackName: "Demo", artworkUrl: null,
  supportedLanguages: ["en"], trackedKeywords: [], storeLinks: [],
  updatedAt: checkedAt,
});
store.snapshots.add([{
  projectName: "demo", productId: "demo:ios", keyword: "night walk",
  language: "en", storefront: "us", rank: 12, totalResults: 50, checkedAt,
}]);

const fromDb = resolveBriefRankData(store, "demo", "demo:ios", []);
assert.equal(fromDb.source, "sqlite");
assert.equal(fromDb.snapshots.length, 1);

const fallback = [{ keyword: "fallback", language: "en", storefront: "us", rank: null, checkedAt }];
const fromFallback = resolveBriefRankData(store, "demo", "demo:macos", fallback);
assert.equal(fromFallback.source, "project-fallback");
assert.deepEqual(fromFallback.snapshots, fallback);

const empty = resolveBriefRankData(store, "demo", "demo:macos", []);
assert.equal(empty.source, "none");
assert.deepEqual(empty.snapshots, []);

let reportedError: unknown;
const failedStore = {
  snapshots: { history: () => { throw new Error("database unavailable"); } },
} as unknown as Parameters<typeof resolveBriefRankData>[0];
const fromErrorFallback = resolveBriefRankData(
  failedStore,
  "demo",
  "demo:ios",
  fallback,
  (error) => { reportedError = error; },
);
assert.equal(fromErrorFallback.source, "project-fallback");
assert.deepEqual(fromErrorFallback.snapshots, fallback);
assert.match(String(reportedError), /database unavailable/);

console.log("brief rank data tests passed");
