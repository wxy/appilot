import {
  createCompetitor,
  competitorPlatforms,
  competitorTrackIdFor,
  fetchCompetitorSnapshot,
  findCompetitorByName,
  migrateCompetitor,
  normalizeCompetitorName,
  searchCompetitorCandidates,
  searchCompetitorCandidatesAcross,
} from "../src/competitor-radar";
import type { Competitor } from "../src/competitor-radar";

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
      { trackId: 1, trackName: "Global App", subtitle: "Subtitle here", screenshotUrls: ["https://example.com/1.png"], primaryGenreName: "Productivity", averageUserRating: 4.9, trackViewUrl: "https://apps.apple.com/us/app/1/id1", bundleId: "com.global.app" },
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
    check(candidates[0]?.platform === "ios", "候选带平台标记（默认 software → ios）");
    check(candidates[0]?.screenshotUrl === "https://example.com/1.png" && candidates[0]?.subtitle === "Subtitle here", "候选带截图与副标题");
    const macCandidates = await searchCompetitorCandidates({
      term: "walk",
      country: "us",
      entity: "macSoftware",
    });
    check(macCandidates[0]?.platform === "macos", "macSoftware 搜索候选标记为 macos");
    const across = await searchCompetitorCandidatesAcross({
      term: "walk",
      countries: ["us", "sg"],
      excludeBundleIds: ["com.mine.app"],
    });
    check(
      across.map((c) => c.trackId).join(",") === "1,3",
      "多商店合并：跨商店出现优先、平均排名靠前优先",
    );
    check(
      across[0]?.countries?.length === 2 && across[0]?.ranks?.us === 1,
      "跨商店竞品记录出现商店与各商店排名",
    );
    check(
      across.find((c) => c.trackId === "3")?.country === "sg",
      "本地竞品标记来源商店",
    );
    const snapshot = await fetchCompetitorSnapshot(competitor, "token-1");
    check(snapshot.version === "2.0.0" && snapshot.stars === 88 && snapshot.recentReleases[0]?.tag === "v2.0.0", "快照解析 lookup + GitHub stars/releases");
    check(snapshot.date === new Date().toISOString().slice(0, 10), "快照 date 为当天");
    const snapSg = await fetchCompetitorSnapshot({ ...competitor, trackId: "1" }, null, "sg");
    check(snapSg.country === "sg", "快照记录来源商店");
    const snapMac = await fetchCompetitorSnapshot(
      { ...competitor, trackIds: { ios: "123", macos: "456" } },
      null,
      "us",
      "macos",
    );
    check(snapMac.platform === "macos", "快照记录平台");
  } catch (err: any) {
    check(false, `competitor-radar 异常: ${err.message}`);
  } finally {
    globalThis.fetch = originalFetch;
    if (errors) process.exit(1);
  }
}
void run();

check(
  normalizeCompetitorName("  AI Pulse  ") === "ai pulse",
  "竞品名称归一化（去空格/小写）",
);
{
  const legacy = migrateCompetitor({
    id: "cid-1",
    name: "Comp",
    trackId: "123",
    platform: "ios",
    githubUrl: null,
    notes: "",
    addedAt: "2026-08-24T00:00:00Z",
  });
  check(
    legacy.trackIds?.ios === "123" && legacy.trackIds?.macos == null,
    "旧数据迁移：trackId+platform 填入按平台字段",
  );
  check(
    competitorTrackIdFor(legacy, "ios") === "123" &&
      competitorTrackIdFor(legacy, "macos") === null,
    "按平台取 trackId（未上架平台为 null）",
  );
  check(
    JSON.stringify(competitorPlatforms(legacy)) === JSON.stringify(["ios"]),
    "只返回已上架平台",
  );
}
{
  const dual = migrateCompetitor({
    id: "cid-2",
    name: "Pulse",
    trackId: "111",
    platform: "macos",
    trackIds: { ios: "222", macos: "111" },
    githubUrl: null,
    notes: "",
    addedAt: "2026-08-24T00:00:00Z",
  });
  check(
    competitorTrackIdFor(dual, "ios") === "222" &&
      competitorTrackIdFor(dual, "macos") === "111",
    "双平台 trackIds 分别取用",
  );
  const list = [dual];
  check(
    findCompetitorByName(list, " pulse ")?.id === "cid-2",
    "同名竞品查找（忽略大小写/空格）",
  );
  check(findCompetitorByName(list, "Other") === null, "不同名不误合并");
}

if (errors) process.exit(1);
console.log("\n🎉 All competitor-radar tests passed!");
