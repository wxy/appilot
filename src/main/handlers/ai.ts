import { ipcMain } from "electron";
import {
  decryptApiKey,
  encryptApiKey,
  looksLikeEncryptedBlob,
} from "../credentials";
import { getStore } from "../store";

export function registerAiHandlers(): void {
  ipcMain.handle("ai:getConfig", async () => {
    const s = await getStore();
    const stored = s.get("aiApiKey") || "";
    const apiKey = decryptApiKey(stored);
    return {
      providerUrl: s.get("aiProviderUrl"),
      apiKey,
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

  ipcMain.handle("ai:testConnection", async (_event, config: { providerUrl: string; apiKey: string; model: string }) => {
    const { AIProvider } = await import("../../engine/ai/ai-provider");
    const provider = new AIProvider({
      baseURL: config.providerUrl,
      apiKey: config.apiKey,
      model: config.model,
    });
    return provider.validateConnection();
  });

  ipcMain.handle("ai:listModels", async (_event, config: { providerUrl: string; apiKey: string }) => {
    const providerUrl = String(config?.providerUrl || "").trim().replace(/\/+$/, "");
    if (!providerUrl) return { models: [], error: "缺少供应商 URL" };
    const apiKey = String(config?.apiKey || "").trim();
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
