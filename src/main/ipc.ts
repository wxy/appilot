import { ipcMain, shell } from "electron";
import { AIProvider } from "../engine/ai/ai-provider";

// electron-store v10+ is ESM-only. Use dynamic import for CJS compat.
let store: any = null;
let StoreClass: any = null;

async function getStore() {
  if (!store) {
    const mod = await import("electron-store");
    StoreClass = mod.default;
    store = new StoreClass({
      defaults: {
        aiProviderUrl: "https://api.openai.com/v1",
        aiApiKey: "",
        aiModel: "gpt-4o",
      },
    });
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
    const provider = new AIProvider({
      baseURL: s.get("aiProviderUrl"),
      apiKey: s.get("aiApiKey"),
      model: s.get("aiModel"),
    });
    const { RepoAnalyzer } = await import("../engine/repo-analyzer");
    const { AIEngine } = await import("../engine/ai/ai-engine");

    const analyzer = new RepoAnalyzer();
    const engine = new AIEngine(analyzer, provider);
    const result = await engine.analyzeProduct(repoUrl);
    if (provider.lastUsage) trackAiUsage(provider.lastUsage.totalTokens, provider.lastUsage.estimatedCost);
    return result;
  });

  ipcMain.handle("ai:generateTweet", async (_event, repoUrl: string, stage: string) => {
    const s = await getStore();
    const provider = new AIProvider({
      baseURL: s.get("aiProviderUrl"),
      apiKey: s.get("aiApiKey"),
      model: s.get("aiModel"),
    });
    const { RepoAnalyzer } = await import("../engine/repo-analyzer");
    const { AIEngine } = await import("../engine/ai/ai-engine");

    const analyzer = new RepoAnalyzer();
    const engine = new AIEngine(analyzer, provider);
    const result = await engine.generateTweet(repoUrl, stage as any);
    if (provider.lastUsage) trackAiUsage(provider.lastUsage.totalTokens, provider.lastUsage.estimatedCost);
    return result;
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
