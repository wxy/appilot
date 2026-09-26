import { ipcMain } from "electron";
import {
  decryptApiKey,
  encryptApiKey,
  looksLikeEncryptedBlob,
} from "../credentials";
import { isAllowedAiProviderUrl } from "../url-policy";
import { getStore } from "../store";

/** 掩码展示：仅暴露首尾少量字符，供 UI 提示「已配置」，绝不回传明文。 */
function maskApiKey(key: string): string {
  const trimmed = key.trim();
  if (!trimmed) return "";
  if (trimmed.length <= 8) return "••••";
  return `${trimmed.slice(0, 3)}…${trimmed.slice(-4)}`;
}

/**
 * 解析请求里 API Key 的取值：优先用渲染层现输入的明文；未输入且显式声明
 * useStoredKey 时取主进程内解密的已存 Key（审计 M-M1：明文 Key 不回传渲染层，
 * 「测试连接 / 拉取模型列表」等要用到已存 Key 的场景在主进程内解析）。
 */
async function resolveRequestApiKey(config: { apiKey?: string; useStoredKey?: boolean }): Promise<string> {
  const typed = String(config?.apiKey || "").trim();
  if (typed) return typed;
  if (!config?.useStoredKey) return "";
  const s = await getStore();
  return decryptApiKey(s.get("aiApiKey") || "").trim();
}

export function registerAiHandlers(): void {
  // 审计 M-M1：不再返回明文 apiKey（渲染层一次 XSS 即可窃取）。改为
  // hasApiKey + 掩码；编辑语义 = 留空保持不变（saveConfig 已支持）。
  ipcMain.handle("ai:getConfig", async () => {
    const s = await getStore();
    const stored = s.get("aiApiKey") || "";
    const apiKey = decryptApiKey(stored);
    return {
      providerUrl: s.get("aiProviderUrl"),
      hasApiKey: Boolean(apiKey),
      apiKeyMasked: maskApiKey(apiKey),
      apiKeyBroken: Boolean(
        stored &&
        apiKey &&
        looksLikeEncryptedBlob(stored) &&
        looksLikeEncryptedBlob(apiKey),
      ),
      model: s.get("aiModel"),
    };
  });

  ipcMain.handle("ai:saveConfig", async (_event, config: { providerUrl: string; apiKey: string; model: string }) => {
    // 审计 M-M2：providerUrl 是主进程携带真实 Key 发请求的目标，保存时必须
    // 过白名单（https 或本机回环 http），否则「留空 Key 不覆盖」的组合会被
    // 攻破的渲染层改写 endpoint 后把旧 Key 外带。
    if (!isAllowedAiProviderUrl(config.providerUrl)) {
      throw new Error("不支持的供应商 URL（仅允许 https，或本机回环的 http 地址）");
    }
    const s = await getStore();
    s.set("aiProviderUrl", config.providerUrl);
    s.set("aiModel", config.model);
    const currentStored = s.get("aiApiKey") || "";
    const apiKey = config.apiKey || "";
    if (apiKey && apiKey !== currentStored) {
      s.set("aiApiKey", encryptApiKey(apiKey));
    }
    return true;
  });

  ipcMain.handle("ai:testConnection", async (_event, config: { providerUrl: string; apiKey: string; model: string; useStoredKey?: boolean }) => {
    // 审计 M-M3：testConnection 是主进程代理 fetch（携带 Key），入口同样过
    // 白名单，防渲染层借道探测任意 http(s) 端点。
    if (!isAllowedAiProviderUrl(config.providerUrl)) {
      throw new Error("不支持的供应商 URL（仅允许 https，或本机回环的 http 地址）");
    }
    const { AIProvider } = await import("@appilot-labs/appilot-core/ai/ai-provider");
    const provider = new AIProvider({
      baseURL: config.providerUrl,
      apiKey: await resolveRequestApiKey(config),
      model: config.model,
    });
    return provider.validateConnection();
  });

  ipcMain.handle("ai:listModels", async (_event, config: { providerUrl: string; apiKey: string; useStoredKey?: boolean }) => {
    const providerUrl = String(config?.providerUrl || "").trim().replace(/\/+$/, "");
    if (!providerUrl) return { models: [], error: "缺少供应商 URL" };
    // 审计 M-M3：同 testConnection——主进程代理 fetch 前先过端点白名单。
    if (!isAllowedAiProviderUrl(providerUrl)) {
      return { models: [], error: "不支持的供应商 URL（仅允许 https，或本机回环的 http 地址）" };
    }
    const apiKey = await resolveRequestApiKey(config);
    try {
      const res = await fetch(`${providerUrl}/models`, {
        headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
      });
      if (!res.ok) {
        // 审计 M-M3：不回显远端响应体（防内网内容 oracle），仅返回状态码。
        return {
          models: [],
          error: `模型列表请求失败（${res.status}）：${res.statusText || "请求未成功"}`,
        };
      }
      const data: any = await res.json();
      const models = (Array.isArray(data?.data) ? data.data : [])
        .map((item: any) => String(item?.id || "").trim())
        .filter(Boolean)
        .sort((a: string, b: string) => a.localeCompare(b));
      return { models, error: "" };
    } catch (err: any) {
      return { models: [], error: err?.message || String(err) };
    }
  });

  // ── Analytics / Stats (Task 0.13/0.14) ──
  ipcMain.handle("stats:aiUsage", async () => {
    const s = await getStore();
    return (
      s.get("aiUsage") || {
        calls: 0,
        promptTokens: 0,
        completionTokens: 0,
        cachedTokens: 0,
        totalTokens: 0,
        estimatedCost: 0,
      }
    );
  });
}
