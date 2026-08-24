import fs from "fs";
import os from "os";
import path from "path";
import { execFileSync } from "child_process";
import { fetchReleaseAssetDownloads, fetchTrafficSnapshot } from "../src/engine/gh-traffic";

let errors = 0;
function check(ok: boolean, msg: string) {
  if (ok) console.log(`✅ PASS: ${msg}`);
  else { console.error(`❌ FAIL: ${msg}`); errors++; }
}
function run(dir: string, args: string[]) {
  execFileSync("git", ["-C", dir, ...args], { stdio: "pipe" });
}
function setupRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "appilot-ghtraffic-"));
  run(dir, ["init", "-q"]);
  run(dir, ["remote", "add", "origin", "https://github.com/wxy/glowalk.git"]);
  return dir;
}

async function runTests() {
  const dir = setupRepo();
  const calls: { url: string; auth: string }[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: any, init?: any) => {
    const url = typeof input === "string" ? input : String(input);
    calls.push({ url, auth: init?.headers?.Authorization || "" });
    if (url.includes("/traffic/views")) {
      return new Response(JSON.stringify({ count: 120, uniques: 40, views: [{ timestamp: "2026-08-24T00:00:00Z", count: 120, uniques: 40 }] }), { status: 200 });
    }
    if (url.includes("/traffic/clones")) {
      return new Response(JSON.stringify({ count: 8, uniques: 5, clones: [{ timestamp: "2026-08-24T00:00:00Z", count: 8, uniques: 5 }] }), { status: 200 });
    }
    if (url.includes("/traffic/popular/referrers")) {
      return new Response(JSON.stringify([{ referrer: "google.com", count: 60, uniques: 20 }]), { status: 200 });
    }
    if (url.includes("/releases/tags/")) {
      if (url.includes("v9.9.9")) return new Response("not found", { status: 404 });
      return new Response(JSON.stringify({ tag_name: "v1.0.0", assets: [{ name: "GloWalk.dmg", download_count: 42 }] }), { status: 200 });
    }
    return new Response("not found", { status: 404 });
  }) as any;

  try {
    const snapshot = await fetchTrafficSnapshot(dir, "token-1");
    check(snapshot?.views === 120 && snapshot?.clones === 8, "traffic 快照解析 views/clones");
    check(snapshot?.referrers[0]?.url === "google.com", "traffic 解析 referrers");
    check(calls[0].auth === "Bearer token-1", "traffic 请求带 Bearer token");
    check(snapshot?.date === new Date().toISOString().slice(0, 10), "快照 date 为当天");
    const noToken = await fetchTrafficSnapshot(dir, null);
    check(noToken === null, "无 token 时 traffic 返回 null");
    const assets = await fetchReleaseAssetDownloads(dir, "v1.0.0", "token-1");
    check(assets?.assets[0]?.downloadCount === 42, "release 资产解析 download_count");
    const missing = await fetchReleaseAssetDownloads(dir, "v9.9.9", "token-1");
    check(missing === null, "release 404 时返回 null");
  } catch (err: any) {
    check(false, `gh-traffic 异常: ${err.message}`);
  } finally {
    globalThis.fetch = originalFetch;
    if (errors) process.exit(1);
  }
}
void runTests();
