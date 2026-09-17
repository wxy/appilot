import {
  ITUNES_SEARCH_BLOCK_KV_KEY,
  ITUNES_SEARCH_BLOCK_MS,
  collectKeywordRankings,
  computeItunesSearchBlock,
  formatItunesBlockClock,
  isItunesSearchBlocked,
  isItunesSearchForbidden,
  itunesSearchApiError,
  itunesSearchBlockFriendlyMessage,
  itunesSearchBlockUntilIso,
  itunesSearchBlockUntilIsoForNow,
  searchAppStoreRank,
  setItunesSearchPacingForTests,
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
  // 测试关闭全局节拍（否则 3.2s/请求会拖慢用例）。
  setItunesSearchPacingForTests(0);
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

  // ── 级别化冷却：复发升级 + 新旧格式兼容 ──
  const base = Date.parse("2026-09-17T03:00:00Z");
  const first = computeItunesSearchBlock(undefined, base);
  assert(first.state.level === 1 && !first.escalated, "首次熔断 level=1");
  assert(
    new Date(first.untilIso).getTime() === base + ITUNES_SEARCH_BLOCK_MS,
    "level1 冷却 45 分钟",
  );
  assert(
    isItunesSearchBlocked(JSON.stringify(first.state), base + 60_000) === true &&
      isItunesSearchBlocked(first.state, base + 60_000) === true,
    "新格式（文本/对象）冷却中判定",
  );
  // 冷却解除后 5 分钟复发 → 升 level2（90 分钟）
  const recurrenceAt = base + ITUNES_SEARCH_BLOCK_MS + 5 * 60_000;
  const kvText = JSON.stringify(first.state);
  const second = computeItunesSearchBlock(kvText, recurrenceAt);
  assert(second.state.level === 2 && second.escalated, "复发窗口内再次 403 → level2");
  assert(
    new Date(second.untilIso).getTime() === recurrenceAt + ITUNES_SEARCH_BLOCK_MS * 2,
    "level2 冷却 90 分钟",
  );
  // 旧格式（裸 ISO）也参与复发升级
  const legacy = computeItunesSearchBlock(
    new Date(base + ITUNES_SEARCH_BLOCK_MS).toISOString(),
    base + ITUNES_SEARCH_BLOCK_MS + 60_000,
  );
  assert(legacy.state.level === 2, "旧格式 ISO 同样识别复发升级");
  // 解除很久之后 → 回 level1
  const muchLater = new Date(second.untilIso).getTime() + 3600_000;
  const third = computeItunesSearchBlock(JSON.stringify(second.state), muchLater);
  assert(third.state.level === 1 && !third.escalated, "超过复发窗口 → 回 level1");
  // 对象形态（electron store.get 反序列化后）
  const viaObj = computeItunesSearchBlock(second.state, muchLater);
  assert(viaObj.state.level === 1, "对象形态（store.get）同样解析并回落 level1");
  // 级别封顶
  const capped = computeItunesSearchBlock(
    JSON.stringify({ until: new Date(base).toISOString(), level: 4 }),
    base + 60_000,
  );
  assert(capped.state.level === 4, "level 封顶 4（3 小时）");
  assert(
    isItunesSearchBlocked(JSON.stringify({ until: new Date(base).toISOString(), level: 4 }), base + 60_000) ===
      true,
    "封顶级别仍是熔断中",
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
