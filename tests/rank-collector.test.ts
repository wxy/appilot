import { searchAppStoreRank, collectKeywordRankings } from "../src/engine/rank-collector";

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
}

run().finally(() => {
  (globalThis as any).fetch = originalFetch;
  console.log(`\n${errors === 0 ? "🎉 All rank collector tests passed!" : `❌ ${errors} test(s) failed`}`);
  process.exit(errors > 0 ? 1 : 0);
});
