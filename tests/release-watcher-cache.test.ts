/**
 * checkForRelease GitHub cache + PR fetch behavior:
 * - a matching githubCache avoids all GitHub API calls;
 * - fetches send the Authorization header when a token is present;
 * - PR info cache is token-aware (different token ⇒ refetch).
 */
import fs from "fs";
import os from "os";
import path from "path";
import { execFileSync } from "child_process";
import { checkForRelease } from "../src/engine/release-watcher";

let errors = 0;
function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`❌ FAIL: ${msg}`);
    errors++;
  } else {
    console.log(`✅ PASS: ${msg}`);
  }
}

function run(dir: string, args: string[]) {
  execFileSync("git", ["-C", dir, ...args], { stdio: "pipe" });
}

function setupRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "appilot-cache-"));
  run(dir, ["init", "-q"]);
  run(dir, ["config", "user.email", "test@example.com"]);
  run(dir, ["config", "user.name", "Test"]);
  run(dir, ["remote", "add", "origin", "https://github.com/owner/repo.git"]);
  fs.writeFileSync(path.join(dir, "a.txt"), "a");
  run(dir, ["add", "."]);
  run(dir, ["commit", "-q", "-m", "feat: walk (#1)"]);
  run(dir, ["tag", "v1.0.0"]);
  return dir;
}

async function runTests() {
  const dir = setupRepo();
  const calls: { url: string; auth: string }[] = [];
  const origFetch = globalThis.fetch;
  globalThis.fetch = (async (input: any, init?: any) => {
    const url = typeof input === "string" ? input : String(input);
    calls.push({ url, auth: init?.headers?.Authorization || "" });
    if (url.includes("/pulls/")) {
      const num = url.match(/\/pulls\/(\d+)/)?.[1] || "0";
      return new Response(
        JSON.stringify({
          title: `PR #${num} real title`,
          body: `body ${num}`,
          html_url: `https://github.com/owner/repo/pull/${num}`,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    return new Response(
      JSON.stringify({
        tag_name: "v1.0.0",
        name: "v1.0.0",
        body: "release body",
        published_at: "2026-01-01T00:00:00Z",
        html_url: "https://github.com/owner/repo/releases/tag/v1.0.0",
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as any;

  try {
    // 1. Matching githubCache ⇒ zero GitHub API calls.
    const cached = await checkForRelease(dir, null, undefined, {
      sync: false,
      githubCache: {
        tag: "v1.0.0",
        release: { name: "cached", body: "cached release body", publishedAt: null, url: null },
        pullRequests: [{ number: 1, title: "cached PR title" }],
      },
    });
    assert(calls.length === 0, "matching githubCache performs no GitHub API calls");
    assert(
      cached.latest?.material?.githubRelease?.body === "cached release body",
      "cached release body is used",
    );
    assert(
      cached.latest?.material?.pullRequests?.[0]?.title === "cached PR title",
      "cached PR info is used",
    );

    // 2. No cache ⇒ fetch with Authorization header.
    const withToken = await checkForRelease(dir, null, "ghp_secret", { sync: false });
    const prCall = calls.find((c) => c.url.includes("/pulls/1"));
    assert(Boolean(prCall), "without cache, PR info is fetched");
    assert(prCall?.auth === "Bearer ghp_secret", "PR fetch carries the token");
    assert(
      withToken.latest?.material?.pullRequests?.[0]?.title === "PR #1 real title",
      "fetched PR title replaces the local fallback",
    );

    // 3. PR cache is token-aware: same token ⇒ no refetch, different token ⇒ refetch.
    const prCallsBefore = calls.filter((c) => c.url.includes("/pulls/")).length;
    await checkForRelease(dir, null, "ghp_secret", { sync: false });
    const prCallsSameToken = calls.filter((c) => c.url.includes("/pulls/")).length;
    assert(prCallsSameToken === prCallsBefore, "same token reuses the PR cache");

    await checkForRelease(dir, null, "ghp_other", { sync: false });
    const prCallsOtherToken = calls.filter((c) => c.url.includes("/pulls/")).length;
    assert(
      prCallsOtherToken > prCallsSameToken,
      "different token bypasses the PR cache (token-aware key)",
    );

    // 4. Empty cached PR list (written by a pre-PR-fetch build) must not be
    // trusted — the workbench refetches instead of showing a blank summary.
    const emptyCacheCalls = calls.length;
    await checkForRelease(dir, null, undefined, {
      sync: false,
      githubCache: {
        tag: "v1.0.0",
        release: { name: "cached", body: "cached body", publishedAt: null, url: null },
        pullRequests: [],
      },
    });
    assert(
      calls.length > emptyCacheCalls,
      "empty cached PR list triggers a fresh PR fetch",
    );

    // 5. An explicit force check bypasses the cached PR list even when the
    // cache tag matches — the latest merged PRs are fetched fresh.
    const forceCalls = calls.length;
    await checkForRelease(dir, null, "ghp_force", {
      sync: false,
      force: true,
      githubCache: {
        tag: "v1.0.0",
        release: { name: "cached", body: "cached body", publishedAt: null, url: null },
        pullRequests: [{ number: 1, title: "cached PR title" }],
      },
    });
    assert(
      calls.length > forceCalls,
      "force check refetches PRs even with a matching cache",
    );
  } finally {
    globalThis.fetch = origFetch;
  }

  if (errors === 0) console.log("\n🎉 All release-watcher cache tests passed!");
  else process.exitCode = 1;
}

void runTests();
