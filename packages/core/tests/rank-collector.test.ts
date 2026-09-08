import {
  ITUNES_SEARCH_BLOCK_KV_KEY,
  ITUNES_SEARCH_BLOCK_MS,
  collectKeywordRankings,
  formatItunesBlockClock,
  isItunesSearchBlocked,
  isItunesSearchForbidden,
  itunesSearchApiError,
  itunesSearchBlockFriendlyMessage,
  itunesSearchBlockUntilIso,
  itunesSearchBlockUntilIsoForNow,
  searchAppStoreRank,
} from "../src/rank-collector";

let errors = 0;
function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`❌ FAIL: ${msg}`);
    errors++;
  } else {
    console.log(`✅ PASS: ${msg}`);
  }
}

const originalFetch = globalThis.fetch;
let lastRequestUrl = "";

function mockFetch(results: any[]) {
  (globalThis as any).fetch = async (url: URL) => {
    lastRequestUrl = String(url);
    return {
      ok: true,
      json: async () => ({
        resultCount: results.length,
        results,
      }),
    };
  };
}

async function run() {
  mockFetch([
    { trackId: 111, trackName: "Other" },
    { trackId: 222, trackName: "Target" },
    { trackId: 333, trackName: "Other 2" },
  ]);

  const found = await searchAppStoreRank({
    term: "target",
    country: "us",
    trackId: "222",
    productType: "ios",
  });
  assert(found.rank === 2, "finds target app at rank 2");
  assert(found.totalResults === 3, "returns result count");
  assert(new URL(lastRequestUrl).searchParams.get("entity") === "software", "uses software entity for iOS");

  const withCandidates = await searchAppStoreRank({
    term: "target",
    country: "us",
    trackId: "222",
    productType: "ios",
    candidateTrackIds: ["111", "333", "999"],
  });
  assert(withCandidates.candidateRanks["111"] === 1, "candidate 111 rank 1");
  assert(withCandidates.candidateRanks["333"] === 3, "candidate 333 rank 3");
  assert(withCandidates.candidateRanks["999"] === null, "missing candidate rank null");

  mockFetch([{ trackId: 999, trackName: "Not target" }]);
  const missing = await searchAppStoreRank({
    term: "missing",
    country: "cn",
    trackId: "222",
    productType: "macos",
  });
  assert(missing.rank === null, "returns null when app is not in results");

  mockFetch([{ trackId: 222, trackName: "Target" }]);
  await searchAppStoreRank({
    term: "target",
    country: "us",
    trackId: "222",
    productType: "macos",
    entity: "macSoftware",
  });
  assert(new URL(lastRequestUrl).searchParams.get("entity") === "macSoftware", "uses explicit macSoftware entity");

  mockFetch([{ trackId: 222, trackName: "Target" }]);
  const collection = await collectKeywordRankings({
    targets: [{ keyword: "ai cost", language: "en", storefront: "us" }],
    trackId: "222",
    productType: "macos",
    delayMs: 0,
  });
  assert(collection.snapshots.length === 1, "collects one snapshot");
  assert(collection.snapshots[0].rank === 1, "collected snapshot has correct rank");
  assert(collection.failed === 0, "no failed lookups");

  // ── iTunes Search 403 熔断共享契约（纯判定） ──
  const now = Date.parse("2026-08-23T12:00:00Z");
  const futureIso = new Date(now + 60_000).toISOString();
  const pastIso = new Date(now - 60_000).toISOString();
  assert(
    itunesSearchBlockUntilIso(futureIso, now) === futureIso,
    "blockedUntil: 未来时刻 → 返回截止 ISO",
  );
  assert(itunesSearchBlockUntilIso(pastIso, now) === null, "blockedUntil: 过去时刻 → null（已解除）");
  assert(
    itunesSearchBlockUntilIso(JSON.stringify(futureIso), now) === futureIso,
    "blockedUntil: 兼容 electron 的 JSON 引号存法",
  );
  assert(itunesSearchBlockUntilIso("garbage", now) === null, "blockedUntil: 非法值 → null");
  assert(itunesSearchBlockUntilIso(undefined, now) === null, "blockedUntil: 未写入 → null");
  assert(isItunesSearchBlocked(futureIso, now) === true, "isItunesSearchBlocked: 未来时刻 = 熔断中");
  assert(isItunesSearchBlocked(pastIso, now) === false, "isItunesSearchBlocked: 过期 = 已解除");
  const untilFor = itunesSearchBlockUntilIsoForNow(now);
  assert(
    new Date(untilFor).getTime() === now + ITUNES_SEARCH_BLOCK_MS,
    "冷却窗口固定 45 分钟（与主进程一致）",
  );
  assert(
    ITUNES_SEARCH_BLOCK_KV_KEY === "itunesSearchBlockedUntil",
    "kv 键名与主进程 scheduler 一致",
  );
  assert(
    /^\d{1,2}:\d{2}$/.test(formatItunesBlockClock(untilFor)),
    "冷却时钟格式 HH:mm",
  );
  assert(
    itunesSearchBlockFriendlyMessage(untilFor).includes("403") &&
      itunesSearchBlockFriendlyMessage(untilFor).includes("请稍后再试"),
    "友好文案含 403 与稍后再试",
  );
  assert(isItunesSearchForbidden(itunesSearchApiError(403)) === true, "403 谓词命中结构化错误");
  assert(isItunesSearchForbidden(itunesSearchApiError(429)) === false, "429 不属于熔断");
  assert(
    isItunesSearchForbidden(Object.assign(new Error("iTunes Search API 403"), {})) === true,
    "403 谓词兜底匹配文本",
  );

  // ── 采集途中 403 → 整批中止并向上抛（供 projects:collectRanks 触发熔断） ──
  (globalThis as any).fetch = async () =>
    ({ ok: false, status: 403, text: async () => "" }) as any;
  let forbiddenAborted = false;
  try {
    await collectKeywordRankings({
      targets: [
        { keyword: "a", language: "en", storefront: "us" },
        { keyword: "b", language: "en", storefront: "us" },
      ],
      trackId: "222",
      productType: "ios",
      delayMs: 0,
    });
  } catch (err: any) {
    forbiddenAborted = isItunesSearchForbidden(err);
  }
  assert(forbiddenAborted, "403 中断整批（不再继续打后续目标）并向上抛");
}

run().finally(() => {
  (globalThis as any).fetch = originalFetch;
  console.log(`\n${errors === 0 ? "🎉 All rank collector tests passed!" : `❌ ${errors} test(s) failed`}`);
  process.exit(errors > 0 ? 1 : 0);
});
