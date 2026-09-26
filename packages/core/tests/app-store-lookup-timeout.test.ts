/**
 * iTunes lookup 超时与编码契约测试（审计 2026-09-26 M-C4）：
 * app-store-discovery 的三处 fetch 曾是全库唯一无 AbortController 的调用，
 * 可挂起分钟级拖住 Electron 主进程；lookupApp 的 trackId 未编码，可篡改查询。
 * 通过替换全局 fetch 断言：请求带 AbortSignal、trackId 被编码、失败降级 null。
 * 纯 node。
 */
import assert from "node:assert/strict";
import { fetchJsonWithTimeout, lookupApp } from "../src/app-store-discovery";

const realFetch = globalThis.fetch;

async function main() {
  const seen: { url: string; signal: unknown }[] = [];
  globalThis.fetch = (async (url: string | URL, init?: RequestInit): Promise<Response> => {
    seen.push({ url: String(url), signal: init?.signal });
    return {
      ok: true,
      json: async () => ({
        results: [
          {
            trackId: 123,
            trackName: "Demo App",
            bundleId: "com.example.demo",
            kind: "software",
            version: "1.2.3",
            averageUserRating: 4.5,
            userRatingCount: 10,
            primaryGenreName: "Utilities",
            artworkUrl512: "https://example.com/a.png",
          },
        ],
      }),
    } as unknown as Response;
  }) as unknown as typeof fetch;

  try {
    // 1) 恶意/畸形 trackId 必须被编码，不得篡改查询
    const meta = await lookupApp("123&country=cn");
    assert.equal(seen.length, 1, "应发起一次 lookup");
    assert.ok(
      seen[0].url.includes("id=123%26country%3Dcn"),
      `trackId 应被 encodeURIComponent（实际 ${seen[0].url}）`,
    );
    assert.ok(seen[0].signal instanceof AbortSignal, "lookup 请求应携带 AbortSignal（超时控制）");
    assert.equal(meta?.trackName, "Demo App", "成功路径元数据映射不变");

    // 2) Headers 已到，但 JSON body 挂起：超时须持续到 body 解析结束。
    globalThis.fetch = (async (_url: string | URL, init?: RequestInit): Promise<Response> => {
      return {
        ok: true,
        json: () => new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("body aborted")));
        }),
      } as unknown as Response;
    }) as unknown as typeof fetch;
    const bodyStarted = Date.now();
    await assert.rejects(fetchJsonWithTimeout("https://itunes.apple.com/lookup?id=123", 25));
    assert.ok(Date.now() - bodyStarted < 1000, "body 挂起应在测试时限内中止");

    // 3) Headers 前挂起同样应超时。
    globalThis.fetch = (async (_url: string | URL, init?: RequestInit): Promise<Response> => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("This operation was aborted")));
      }) as unknown as Promise<Response>;
    }) as unknown as typeof fetch;
    await assert.rejects(fetchJsonWithTimeout("https://itunes.apple.com/lookup?id=123", 25));

    // 4) 网络错误与异常 JSON 仍由 lookupApp 降级为 null。
    globalThis.fetch = (async () => { throw new Error("network failure"); }) as unknown as typeof fetch;
    seen.length = 0;
    const failed = await lookupApp("123");
    assert.equal(failed, null, "网络失败应降级为 null");
    globalThis.fetch = (async () => ({ ok: true, json: async () => { throw new Error("invalid JSON"); } })) as unknown as typeof fetch;
    assert.equal(await lookupApp("123"), null, "异常 JSON 应降级为 null");
  } finally {
    globalThis.fetch = realFetch;
  }
  console.log("app-store lookup 超时/编码契约测试全部通过 ✓");
}

main().catch((err) => {
  console.error("lookup 契约测试失败:", err);
  process.exit(1);
});
