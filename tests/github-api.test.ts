import fs from "fs";
import os from "os";
import path from "path";
import { execFileSync } from "child_process";
import {
  fetchGitHubRelease,
  fetchPullRequests,
} from "../src/engine/github-api";

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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "appilot-ghapi-"));
  run(dir, ["init", "-q"]);
  run(dir, ["remote", "add", "origin", "https://github.com/owner/repo.git"]);
  return dir;
}

async function runTests() {
  const dir = setupRepo();
  const calls: { url: string; auth: string }[] = [];
  let status = 200;
  const origFetch = globalThis.fetch;
  globalThis.fetch = (async (input: any, init?: any) => {
    const url = typeof input === "string" ? input : String(input);
    calls.push({ url, auth: init?.headers?.Authorization || "" });
    if (status !== 200) return new Response("not found", { status });
    if (url.includes("/pulls/")) {
      const num = url.match(/\/pulls\/(\d+)/)?.[1] || "0";
      return new Response(
        JSON.stringify({
          title: `PR #${num} real`,
          body: "body",
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
    let stats = { request: 0, response: 0 };
    const release = await fetchGitHubRelease(dir, "v1.0.0", "ghp_secret", (rb, pb) => {
      stats = { request: rb, response: pb };
    });
    assert(release?.name === "v1.0.0", "release fetched");
    assert(release?.viaToken === true, "release viaToken flag");
    assert(calls[0]?.auth === "Bearer ghp_secret", "release fetch carries the token");
    assert(stats.response > 0, "onStats reports response bytes");

    status = 404;
    const missing = await fetchGitHubRelease(dir, "v9.9.9");
    assert(missing === null, "404 release → null");
    status = 200;

    const prs = await fetchPullRequests(dir, [{ number: 1, title: "local" }], "ghp_secret");
    assert(prs[0]?.title === "PR #1 real", "PR enriched from GitHub");
    const prCall = calls.find((c) => c.url.includes("/pulls/1"));
    assert(prCall?.auth === "Bearer ghp_secret", "PR fetch carries the token");

    const before = calls.filter((c) => c.url.includes("/pulls/")).length;
    await fetchPullRequests(dir, [{ number: 1, title: "local" }], "ghp_secret");
    const same = calls.filter((c) => c.url.includes("/pulls/")).length;
    assert(same === before, "same token reuses the PR cache");

    await fetchPullRequests(dir, [{ number: 1, title: "local" }], "ghp_other");
    const other = calls.filter((c) => c.url.includes("/pulls/")).length;
    assert(other > same, "different token bypasses the PR cache");
  } finally {
    globalThis.fetch = origFetch;
  }

  if (errors === 0) console.log("\n🎉 All github-api tests passed!");
  else process.exitCode = 1;
}

void runTests();
