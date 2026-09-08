/**
 * Overview repo-metrics API tests (fetchRepoIssueCounts / countPullsSince).
 * Network is stubbed by replacing globalThis.fetch; never hits GitHub.
 */

import {
  countPullsSince,
  fetchRepoIssueCounts,
} from "../src/github-api";

let errors = 0;
function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`❌ FAIL: ${msg}`);
    errors++;
  } else {
    console.log(`✅ PASS: ${msg}`);
  }
}

interface StubResponse {
  url: string;
  headers: Record<string, string>;
}

async function runTests() {
  const origFetch = globalThis.fetch;
  const calls: StubResponse[] = [];

  function stubFetch(handler: (url: string, init?: any) => Response | Promise<Response>) {
    calls.length = 0;
    globalThis.fetch = (async (input: any, init?: any) => {
      const url = typeof input === "string" ? input : String(input);
      calls.push({ url, headers: { ...((init as any)?.headers || {}) } });
      return handler(url, init);
    }) as any;
  }

  const searchResponse = (total: number) =>
    new Response(JSON.stringify({ total_count: total }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });

  // 1. fetchRepoIssueCounts parses open/closed totals from /search/issues.
  stubFetch((url) => {
    const q = new URL(url).searchParams.get("q") || "";
    assert(
      q.includes("repo:ownerA/repoA") && q.includes("is:issue"),
      "issues: search query scopes to repo + is:issue",
    );
    return q.includes("state:open") ? searchResponse(4) : searchResponse(17);
  });
  const counts = await fetchRepoIssueCounts("ownerA/repoA", "tok-1");
  assert(counts?.open === 4 && counts?.closed === 17, "issues: open/closed totals parsed");
  assert(calls.every((c) => c.headers.Authorization === "Bearer tok-1"), "issues: token header attached");
  assert(calls.length === 2, "issues: exactly two search calls (open + closed)");
  const countsCached = await fetchRepoIssueCounts("ownerA/repoA", "tok-1");
  assert(countsCached?.open === 4 && calls.length === 2, "issues: in-process cache avoids refetch");

  // 2. fetchRepoIssueCounts degrades to null on API failure (403 private/rate).
  stubFetch(() => new Response("rate limited", { status: 403 }));
  const degraded = await fetchRepoIssueCounts("ownerB/repoB", "tok-2");
  assert(degraded === null, "issues: failure degrades to null (no throw)");

  // 3. fetchRepoIssueCounts: invalid repo (404) → null.
  stubFetch(() => new Response("not found", { status: 404 }));
  assert((await fetchRepoIssueCounts("ownerC/repoC", "tok-3")) === null, "issues: 404 degrades to null");

  // 4. countPullsSince counts only PRs created at/after the boundary.
  const base = Date.now();
  const cutoffIso = new Date(base - 2 * 60 * 60_000).toISOString();
  const pr = (createdMinAgo: number, number: number) => ({
    number,
    title: `pr-${number}`,
    created_at: new Date(base - createdMinAgo * 60_000).toISOString(),
  });
  stubFetch((url) => {
    const page = Number(new URL(url).searchParams.get("page") || "1");
    assert(new URL(url).searchParams.get("state") === "all", "pulls: since-boundary uses state=all");
    if (page === 1) {
      // 100 items, all created within the last 2h (>= cutoff).
      return new Response(
        JSON.stringify(Array.from({ length: 100 }, (_, i) => pr(i, i + 1))),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    // 50 items still >= cutoff, then 3 older than cutoff (page walk stops).
    const items = [
      ...Array.from({ length: 50 }, (_, i) => pr(60 + i, 200 + i)),
      ...Array.from({ length: 3 }, (_, i) => pr(150 + i, 300 + i)),
    ];
    return new Response(JSON.stringify(items), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  const sinceCount = await countPullsSince("ownerD/repoD", "tok-4", cutoffIso);
  assert(sinceCount === 150, `pulls: counts 150 PRs since boundary (got ${sinceCount})`);
  assert(
    !calls.some((c) => c.url.includes("page=3")),
    "pulls: stops paging once a page falls below the cutoff",
  );
  assert(
    calls.every((c) => c.headers.Authorization === "Bearer tok-4"),
    "pulls: token header attached",
  );

  // 5. countPullsSince without since counts open PRs (state=open).
  stubFetch((url) => {
    assert(new URL(url).searchParams.get("state") === "open", "pulls: no-since uses state=open");
    return new Response(JSON.stringify([pr(5, 1), pr(30, 2), pr(90, 3)]), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  const openCount = await countPullsSince("ownerE/repoE", "tok-5");
  assert(openCount === 3, `pulls: no since → total open PRs (got ${openCount})`);

  // 6. countPullsSince degrades on HTTP error / network failure.
  stubFetch(() => new Response("forbidden", { status: 403 }));
  assert(
    (await countPullsSince("ownerF/repoF", "tok-6", cutoffIso)) === null,
    "pulls: 403 degrades to null",
  );
  stubFetch(() => {
    throw new Error("network down");
  });
  assert(
    (await countPullsSince("ownerG/repoG", "tok-7", cutoffIso)) === null,
    "pulls: network failure degrades to null",
  );

  globalThis.fetch = origFetch;
  if (errors === 0) console.log("\n🎉 All github-repo-metrics tests passed!");
  else process.exitCode = 1;
}

void runTests();
