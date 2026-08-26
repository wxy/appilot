import {
  createCompetitor,
  fetchCompetitorSnapshot,
  searchCompetitorCandidates,
  searchCompetitorCandidatesAcross,
} from "../src/engine/competitor-radar";
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
  const searchResultsByCountry: Record<string, any[]> = {
    us: [
      { trackId: 1, trackName: "Global App", primaryGenreName: "Productivity", averageUserRating: 4.9, trackViewUrl: "https://apps.apple.com/us/app/1/id1", bundleId: "com.global.app" },
      { trackId: 2, trackName: "Mine", primaryGenreName: "Utilities", averageUserRating: 4.0, trackViewUrl: "https://apps.apple.com/us/app/mine/id2", bundleId: "com.mine.app" },
    ],
    sg: [
      { trackId: 3, trackName: "Local SG App", primaryGenreName: "Utilities", averageUserRating: 4.2, trackViewUrl: "https://apps.apple.com/sg/app/3/id3", bundleId: "com.sg.app" },
      { trackId: 1, trackName: "Global App", primaryGenreName: "Productivity", averageUserRating: 4.9, trackViewUrl: "https://apps.apple.com/sg/app/1/id1", bundleId: "com.global.app" },
    ],
  };
  globalThis.fetch = (async (input: any) => {
    const url = typeof input === "string" ? input : String(input);
    if (url.startsWith("https://itunes.apple.com/search")) {
      const country = new URL(url).searchParams.get("country")?.toLowerCase() || "us";
      return new Response(JSON.stringify({ results: searchResultsByCountry[country] || [] }), { status: 200 });
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
    const candidates = await searchCompetitorCandidates({
      term: "walk",
      country: "us",
      excludeTrackIds: ["2"],
      excludeBundleIds: ["com.mine.app"],
    });
    check(candidates.length === 1 && candidates[0]?.trackId === "1", "排除自己（trackId/bundleId）");
    check(candidates[0]?.country === "us", "候选带来源商店");
    const across = await searchCompetitorCandidatesAcross({
      term: "walk",
      countries: ["us", "sg"],
      excludeBundleIds: ["com.mine.app"],
    });
    check(
      across.map((c) => c.trackId).join(",") === "1,3",
      "多商店搜索合并去重（本地竞品出现）",
    );
    check(
      across.find((c) => c.trackId === "3")?.country === "sg",
      "本地竞品标记来源商店",
    );
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
