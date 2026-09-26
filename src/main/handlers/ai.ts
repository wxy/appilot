import { ipcMain } from "electron";
import {
  decryptApiKey,
  encryptApiKey,
  looksLikeEncryptedBlob,
} from "../credentials";
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
    const apiKey = await resolveRequestApiKey(config);
    try {
      const res = await fetch(`${providerUrl}/models`, {
        headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        return {
          models: [],
          error: `模型列表请求失败（${res.status}）：${detail.slice(0, 200) || res.statusText}`,
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
