import crypto from "crypto";
import { ascJwt, createAscClient } from "../src/asc-api";

let errors = 0;
function check(ok: boolean, msg: string) {
  if (ok) console.log(`✅ PASS: ${msg}`);
  else { console.error(`❌ FAIL: ${msg}`); errors++; }
}

const { privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();

check((() => {
  const token = ascJwt("issuer-123", "key-abc", pem);
  const [header, payload, signature] = token.split(".");
  const h = JSON.parse(Buffer.from(header, "base64url").toString());
  const p = JSON.parse(Buffer.from(payload, "base64url").toString());
  return h.alg === "ES256" && h.kid === "key-abc" && p.iss === "issuer-123"
    && p.aud === "appstoreconnect-v1" && Buffer.from(signature, "base64url").length === 64;
})(), "ascJwt 生成 ES256 JWT（header/payload 正确，签名 64 字节）");

async function run() {
  const calls: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: any) => {
    const url = typeof input === "string" ? input : String(input);
    calls.push(url);
    if (url.includes("/apps?")) return new Response(JSON.stringify({ data: [{ id: "app-1", type: "apps" }] }), { status: 200 });
    if (url.includes("/appStoreVersions?")) return new Response(JSON.stringify({ data: [{ id: "v1", attributes: { versionString: "1.1.0", appStoreState: "READY_FOR_SALE", createdDate: "2026-08-01T00:00:00Z" }, relationships: { build: { data: { id: "b9" } } } }] }), { status: 200 });
    if (url.includes("/appStoreVersionLocalizations?")) return new Response(JSON.stringify({ data: [{ id: "loc1", attributes: { locale: "en-US", name: "GloWalk", subtitle: "Path of Light", promotionalText: "p", description: "d", whatsNew: "w", keywords: "k" } }] }), { status: 200 });
    if (url.includes("/appInfos?")) return new Response(JSON.stringify({ data: [{ id: "info-1", type: "appInfos" }] }), { status: 200 });
    if (url.includes("/appInfoLocalizations?")) return new Response(JSON.stringify({ data: [{ id: "il1", attributes: { locale: "zh-Hans", name: "GloWalk: 智能夜行手电筒", subtitle: "五维自适应亮度" } }] }), { status: 200 });
    if (url.includes("/builds?")) return new Response(JSON.stringify({ data: [{ id: "b9", attributes: { version: "45", processingState: "VALID" } }] }), { status: 200 });
    if (url.includes("/customerReviews")) return new Response(JSON.stringify({ data: [] }), { status: 200 });
    return new Response("not found", { status: 404 });
  }) as any;

  try {
    const client = createAscClient({ issuerId: "issuer-123", keyId: "key-abc", privateKeyPem: pem });
    const appId = await client.getAppIdByBundleId("wang.xingyu.glowalk");
    check(appId === "app-1", "getAppIdByBundleId 解析 app id");
    const versions = await client.listAppStoreVersions("app-1");
    check(versions[0].versionString === "1.1.0" && versions[0].buildId === "b9", "listAppStoreVersions 解析版本与 buildId");
    const locs = await client.listVersionLocalizations("v1");
    check(locs[0].locale === "en-US" && locs[0].keywords === "k", "listVersionLocalizations 解析本地化字段");
    const appLocs = await client.listAppInfoLocalizations("app-1");
    check(appLocs[0].locale === "zh-Hans" && appLocs[0].name === "GloWalk: 智能夜行手电筒" && appLocs[0].subtitle === "五维自适应亮度", "listAppInfoLocalizations 解析 App 级名称/副标题");
    check(calls.some((c) => c.includes("/appInfos?")), "appInfos 端点被调用");
    const builds = await client.listBuilds("app-1");
    check(builds[0].processingState === "VALID", "listBuilds 解析构建状态");
    check(calls[0].includes("filter[bundleId]=wang.xingyu.glowalk"), "bundleId 查询参数正确");
  } catch (err: any) {
    check(false, `客户端调用异常: ${err.message}`);
  } finally {
    globalThis.fetch = originalFetch;
    if (errors) process.exit(1);
  }
}
void run();
