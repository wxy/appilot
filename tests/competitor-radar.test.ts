import { createCompetitor, fetchCompetitorSnapshot, searchCompetitorCandidates } from "../src/engine/competitor-radar";
import type { Competitor } from "../src/engine/competitor-radar";

let errors = 0;
function check(ok: boolean, msg: string) {
  if (ok) console.log(`✅ PASS: ${msg}`);
  else { console.error(`❌ FAIL: ${msg}`); errors++; }
}

check(createCompetitor({ name: "Comp", trackId: "123", platform: "ios", githubUrl: null, notes: "" }).id === "cid-123", "createCompetitor 生成稳定 id");

const competitor: Competitor = {
  id: "cid-123", name: "Comp", trackId: "123", platform: "ios",
  githubUrl: "https://github.com/wxy/comp.git", notes: "", addedAt: "2026-08-24T00:00:00Z",
};

async function run() {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: any) => {
    const url = typeof input === "string" ? input : String(input);
    if (url.startsWith("https://itunes.apple.com/search")) {
      return new Response(JSON.stringify({ results: [{ trackId: 123, trackName: "Comp", primaryGenreName: "Utilities", averageUserRating: 4.5, trackViewUrl: "https://apps.apple.com/us/app/comp/id123" }] }), { status: 200 });
    }
    if (url.startsWith("https://itunes.apple.com/lookup")) {
      return new Response(JSON.stringify({ results: [{ version: "2.0.0", currentVersionReleaseDate: "2026-08-01T00:00:00Z", price: 0, averageUserRating: 4.5, userRatingCount: 100 }] }), { status: 200 });
    }
    if (url.includes("api.github.com/repos/wxy/comp/releases")) {
      return new Response(JSON.stringify([{ tag_name: "v2.0.0", published_at: "2026-08-01T00:00:00Z" }]), { status: 200 });
    }
    if (url.includes("api.github.com/repos/wxy/comp")) {
      return new Response(JSON.stringify({ stargazers_count: 88 }), { status: 200 });
    }
    return new Response("not found", { status: 404 });
  }) as any;

  try {
    const candidates = await searchCompetitorCandidates({ term: "walk", country: "us" });
    check(candidates[0]?.trackId === "123" && candidates[0]?.trackName === "Comp", "搜索返回候选竞品");
    check(candidates[0]?.trackViewUrl === "https://apps.apple.com/us/app/comp/id123", "搜索返回 App Store 链接");
    const snapshot = await fetchCompetitorSnapshot(competitor, "token-1");
    check(snapshot.version === "2.0.0" && snapshot.stars === 88 && snapshot.recentReleases[0]?.tag === "v2.0.0", "快照解析 lookup + GitHub stars/releases");
    check(snapshot.date === new Date().toISOString().slice(0, 10), "快照 date 为当天");
  } catch (err: any) {
    check(false, `competitor-radar 异常: ${err.message}`);
  } finally {
    globalThis.fetch = originalFetch;
    if (errors) process.exit(1);
  }
}
void run();
