import fs from "fs";
import os from "os";
import path from "path";
import { execFileSync } from "child_process";
import { listGitHubReleases } from "../src/engine/github-api";
import { fetchStoreCurrentVersion } from "../src/engine/app-store-discovery";

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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "appilot-ghrel-"));
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
    if (status !== 200) return new Response("error", { status });
    if (url.includes("/lookup")) {
      return new Response(
        JSON.stringify({
          results: [
            {
              trackId: 123,
              version: "1.1.1",
              trackName: "AI Pulse: Coding Cost Tracker",
              currentVersionReleaseDate: "2026-08-20T07:00:00Z",
              description: "German store description",
              releaseNotes: "German what's new",
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    return new Response(
      JSON.stringify([
        {
          id: 2,
          tag_name: "v1.1.1",
          name: "v1.1.1",
          body: "second",
          draft: false,
          prerelease: false,
          created_at: "2026-08-20T00:00:00Z",
          published_at: "2026-08-20T00:00:00Z",
          html_url: "https://github.com/owner/repo/releases/tag/v1.1.1",
        },
        {
          id: 1,
          tag_name: null,
          name: "v1.1.0 WIP",
          body: "draft body",
          draft: true,
          prerelease: false,
          created_at: "2026-08-19T00:00:00Z",
          published_at: null,
          html_url: "https://github.com/owner/repo/releases/1",
        },
      ]),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as any;

  try {
    let stats = { request: 0, response: 0 };
    const releases = await listGitHubReleases(dir, "ghp_secret", (rb, pb) => {
      stats = { request: rb, response: pb };
    });
    assert(releases.length === 2, "list parsed");
    assert(releases[0].tag === "v1.1.1", "newest first by created_at");
    assert(releases[1].draft === true, "draft flag parsed");
    assert(releases[1].tag === null, "untagged draft keeps tag null");
    assert(releases[1].name === "v1.1.0 WIP", "draft name parsed");
    assert(releases[0].publishedAt === "2026-08-20T00:00:00Z", "publishedAt parsed");
    assert(releases[0].url === "https://github.com/owner/repo/releases/tag/v1.1.1", "url parsed");
    assert(releases[0].viaToken === true, "viaToken true with token");
    assert(calls[0]?.auth === "Bearer ghp_secret", "list carries Bearer token");
    assert(calls[0]?.url.includes("releases?per_page=30"), "per_page=30 requested");
    assert(stats.response > 0, "onStats reports response bytes");

    calls.length = 0;
    const anon = await listGitHubReleases(dir, null);
    assert(calls[0]?.auth === "", "anonymous list has no Authorization header");
    assert(anon[0]?.viaToken === false, "anonymous viaToken false");

    status = 404;
    const denied = await listGitHubReleases(dir, "ghp_secret");
    assert(denied.length === 0, "404 → empty (private repo degradation)");
    status = 200;

    const store = await fetchStoreCurrentVersion("123", "de");
    assert(store?.version === "1.1.1", "store lookup version parsed");
    assert(store?.currentVersionReleaseDate === "2026-08-20T07:00:00Z", "release date parsed");
    assert(calls.some((c) => c.url.includes("lookup?id=123") && c.url.includes("country=de")), "country param passed");

    const { fetchStoreLocalizedCopy } = await import("../src/engine/app-store-discovery");
    const localized = await fetchStoreLocalizedCopy("123", "de");
    assert(localized?.description === "German store description", "per-storefront description parsed");
    assert(localized?.releaseNotes === "German what's new", "per-storefront release notes parsed");
    assert(localized?.version === "1.1.1", "per-storefront version parsed");
    assert(localized?.trackName === "AI Pulse: Coding Cost Tracker", "per-storefront trackName parsed");

    status = 500;
    const storeFail = await fetchStoreCurrentVersion("123");
    assert(storeFail === null, "store lookup failure → null");
    const localizedFail = await fetchStoreLocalizedCopy("123", "de");
    assert(localizedFail === null, "localized copy failure → null");
    status = 200;
  } finally {
    globalThis.fetch = origFetch;
  }

  if (errors) process.exit(1);
  console.log("done");
}

runTests();
