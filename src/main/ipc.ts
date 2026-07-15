import { ipcMain, shell } from "electron";
import { log } from "../engine/logger";

// electron-store v10+ is ESM-only. Use dynamic import for CJS compat.
let store: any = null;

async function getStore() {
  if (!store) {
    try {
      const mod = await import("electron-store");
      store = new mod.default({
        defaults: {
          aiProviderUrl: "https://api.openai.com/v1",
          aiApiKey: "",
          aiModel: "gpt-4o",
        },
      });
    } catch (err: any) {
      log.error(`Failed to load electron-store: ${err.message}`);
      throw err;
    }
  }
  return store;
}

export function registerIpcHandlers() {
  // ── Shell ──
  ipcMain.handle("shell:openExternal", (_event, url: string) => {
    return shell.openExternal(url);
  });

  // ── AI Config ──
  ipcMain.handle("ai:getConfig", async () => {
    const s = await getStore();
    return {
      providerUrl: s.get("aiProviderUrl"),
      apiKey: s.get("aiApiKey"),
      model: s.get("aiModel"),
    };
  });

  ipcMain.handle("ai:saveConfig", async (_event, config: { providerUrl: string; apiKey: string; model: string }) => {
    const s = await getStore();
    s.set("aiProviderUrl", config.providerUrl);
    s.set("aiApiKey", config.apiKey);
    s.set("aiModel", config.model);
    return true;
  });

  ipcMain.handle("ai:testConnection", async (_event, config: { providerUrl: string; apiKey: string; model: string }) => {
    const { AIProvider } = await import("../engine/ai/ai-provider");
    const provider = new AIProvider({
      baseURL: config.providerUrl,
      apiKey: config.apiKey,
      model: config.model,
    });
    return provider.validateConnection();
  });

  // ── AI Engine (Task 0.7) ──
  ipcMain.handle("ai:analyzeProduct", async (_event, repoUrl: string) => {
    const s = await getStore();
    const { AIProvider } = await import("../engine/ai/ai-provider");
    const provider = new AIProvider({
      baseURL: s.get("aiProviderUrl"),
      apiKey: s.get("aiApiKey"),
      model: s.get("aiModel"),
    });
    try {
      const { RepoAnalyzer } = await import("../engine/repo-analyzer");
      const { AIEngine } = await import("../engine/ai/ai-engine");
      const engine = new AIEngine(new RepoAnalyzer(), provider);
      const result = await engine.analyzeProduct(repoUrl);
      if (provider.lastUsage) trackAiUsage(provider.lastUsage.totalTokens, provider.lastUsage.estimatedCost);
      return result;
    } catch (err: any) {
      log.error(`analyzeProduct failed: ${err.message}`, { repoUrl, errorCode: err.code });
      throw err;
    }
  });

  ipcMain.handle("ai:generateTweet", async (_event, repoUrl: string, stage: string) => {
    const s = await getStore();
    const { AIProvider } = await import("../engine/ai/ai-provider");
    const provider = new AIProvider({
      baseURL: s.get("aiProviderUrl"),
      apiKey: s.get("aiApiKey"),
      model: s.get("aiModel"),
    });
    try {
      const { RepoAnalyzer } = await import("../engine/repo-analyzer");
      const { AIEngine } = await import("../engine/ai/ai-engine");
      const engine = new AIEngine(new RepoAnalyzer(), provider);
      const result = await engine.generateTweet(repoUrl, stage as any);
      if (provider.lastUsage) trackAiUsage(provider.lastUsage.totalTokens, provider.lastUsage.estimatedCost);
      return result;
    } catch (err: any) {
      log.error(`generateTweet failed: ${err.message}`, { repoUrl, stage, errorCode: err.code });
      throw err;
    }
  });

  // ── Analytics / Stats (Task 0.13/0.14) ──
  ipcMain.handle("stats:save", async (_event, entry: { views: number; likes: number; comments: number; note: string; permalink: string }) => {
    const s = await getStore();
    const entries: any[] = s.get("stats") || [];
    entries.push({ ...entry, date: new Date().toISOString() });
    s.set("stats", entries);
    return entries;
  });

  ipcMain.handle("stats:list", async () => {
    const s = await getStore();
    return s.get("stats") || [];
  });

  ipcMain.handle("stats:aiUsage", async () => {
    const s = await getStore();
    return s.get("aiUsage") || { calls: 0, totalTokens: 0, estimatedCost: 0 };
  });

  // Track AI usage after each call
  const trackAiUsage = async (tokens: number, cost: number) => {
    const s = await getStore();
    const usage: any = s.get("aiUsage") || { calls: 0, totalTokens: 0, estimatedCost: 0 };
    usage.calls += 1;
    usage.totalTokens += tokens;
    usage.estimatedCost += cost;
    s.set("aiUsage", usage);
  };

  // ── Content Store / Drafts (Task 0.10/0.12) ──
  ipcMain.handle("draft:save", async (_event, content: string) => {
    const s = await getStore();
    s.set("draft", { content, savedAt: new Date().toISOString() });
    return true;
  });

  ipcMain.handle("draft:load", async () => {
    const s = await getStore();
    return s.get("draft") || null;
  });

  // ── Database (placeholder) ──
  ipcMain.handle("db:query", async () => {
    throw new Error("Database not yet wired to IPC");
  });
}
