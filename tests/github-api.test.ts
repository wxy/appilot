import fs from "fs";
import os from "os";
import path from "path";
import { execFileSync } from "child_process";
import {
  fetchRepoCapabilities,
  fetchGitHubRelease,
  fetchMergedPullRequests,
  fetchPullRequests,
  listGitHubReleases,
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
  let rejectToken = false;
  let repoPushPermission: boolean | null = true;
  const origFetch = globalThis.fetch;
  globalThis.fetch = (async (input: any, init?: any) => {
    const url = typeof input === "string" ? input : String(input);
    calls.push({ url, auth: init?.headers?.Authorization || "" });
    if (rejectToken && init?.headers?.Authorization) {
      return new Response("bad credentials", { status: 401 });
    }
    if (status !== 200) return new Response("not found", { status });
    if (url.includes("/commits")) {
      const num = url.match(/\/pulls\/(\d+)\/commits/)?.[1] || "0";
      return new Response(
        JSON.stringify([
          { sha: `fullsha-commit-${num}-a` },
          { sha: `fullsha-commit-${num}-b` },
        ]),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (url.includes("/releases?")) {
      return new Response(
        JSON.stringify([
          {
            id: 2,
            tag_name: "v1.1.0",
            name: "v1.1.0 draft",
            body: "draft body",
            draft: true,
            prerelease: false,
            created_at: "2026-01-02T00:00:00Z",
            published_at: null,
            html_url: "https://github.com/owner/repo/releases/tag/v1.1.0",
          },
          {
            id: 1,
            tag_name: "v1.0.0",
            name: "v1.0.0",
            body: "body",
            draft: false,
            prerelease: false,
            created_at: "2026-01-01T00:00:00Z",
            published_at: "2026-01-01T00:00:00Z",
            html_url: "https://github.com/owner/repo/releases/tag/v1.0.0",
          },
        ]),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (url.includes("/pulls?")) {
      if (url.includes("page=2") || url.includes("page=3")) {
        return new Response("[]", {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(
        JSON.stringify([
          {
            number: 1,
            title: "PR #1 merged",
            body: "body",
            html_url: "https://github.com/owner/repo/pull/1",
            commits: 2,
            merged_at: "2026-02-01T00:00:00Z",
          },
          {
            number: 2,
            title: "PR #2 merged",
            body: "body2",
            html_url: "https://github.com/owner/repo/pull/2",
            commits: 5,
            merged_at: "2025-12-01T00:00:00Z",
          },
        ]),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (url.includes("/repos/") && !url.includes("/pulls") && !url.includes("/releases")) {
      return new Response(
        JSON.stringify({
          default_branch: "main",
          permissions: {
            push: repoPushPermission,
            admin: false,
            maintain: false,
            triage: false,
            pull: true,
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
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

    // Rejected token ⇒ anonymous retry for public repos.
    rejectToken = true;
    const anon = await fetchPullRequests(dir, [{ number: 1, title: "local" }], "ghp_bad");
    assert(anon[0]?.title === "PR #1 real", "rejected token retries anonymously");
    assert(anon[0]?.viaToken === false, "anonymous fallback flags viaToken=false");
    assert(
      calls.filter((c) => c.url.includes("/pulls/1") && c.auth === "").length >= 1,
      "anonymous retry sends no Authorization header",
    );
    rejectToken = false;

    // fetchMergedPullRequests: merged-PR list + per-PR commit shas + cutoff.
    const listCallsBefore = calls.length;
    const merged = await fetchMergedPullRequests(
      dir,
      "2026-01-01T00:00:00.000Z",
      "ghp_secret",
    );
    assert(merged.length === 1, "merged PR list filters by merged_at cutoff");
    assert(merged[0]?.title === "PR #1 merged", "merged PR list carries titles");
    assert(merged[0]?.commits === 2, "merged PR list carries commit counts");
    assert(
      Array.isArray(merged[0]?.commitShas) && merged[0]?.commitShas?.length === 2,
      "merged PR list fetches per-PR commit shas",
    );
    assert(
      merged[0]?.commitShas?.[0] === "fullsha-commit-1-a",
      "merged PR commit shas parsed",
    );

    const listCallsAfterFirst = calls.length;
    await fetchMergedPullRequests(dir, "2026-01-01T00:00:00.000Z", "ghp_secret");
    assert(
      calls.length === listCallsAfterFirst && listCallsAfterFirst > listCallsBefore,
      "merged PR list cached per repo+cutoff+token",
    );
    const repoCallsBefore = calls.filter((c) => c.url.includes("/repos/owner/repo")).length;
    await fetchMergedPullRequests(dir, "2026-01-01T00:00:00.000Z", "ghp_other");
    assert(
      calls.filter((c) => c.url.includes("/repos/owner/repo")).length > repoCallsBefore,
      "different token bypasses the merged PR cache",
    );

    // listGitHubReleases: drafts included with a token; rejected token falls
    // back to anonymous published data for public repos.
    const rels = await listGitHubReleases(dir, "ghp_secret");
    assert(rels.length === 2 && rels.some((r) => r.draft), "releases list includes drafts");
    assert(rels[0]?.tag === "v1.1.0" && rels[0]?.draft === true, "releases sorted newest-first");
    rejectToken = true;
    const relsAnon = await listGitHubReleases(dir, "ghp_bad");
    assert(relsAnon.length === 2, "rejected token retries anonymously");
    assert(
      relsAnon.every((r) => r.viaToken === false),
      "anonymous release fallback flags viaToken=false",
    );
    rejectToken = false;

    // fetchRepoCapabilities: push access gates draft-release visibility.
    const caps = await fetchRepoCapabilities(dir, "ghp_secret");
    assert(caps.push === true, "repo capabilities report push access");
    repoPushPermission = false;
    const capsNoPush = await fetchRepoCapabilities(dir, "ghp_cap_nopush");
    assert(capsNoPush.push === false, "repo capabilities report missing push access");
    repoPushPermission = true;
  } finally {
    globalThis.fetch = origFetch;
  }

  if (errors === 0) console.log("\n🎉 All github-api tests passed!");
  else process.exitCode = 1;
}

void runTests();
