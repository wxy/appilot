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

  // ── Database (placeholder) ──
  ipcMain.handle("db:query", async () => {
    throw new Error("Database not yet wired to IPC");
  });

  // ── AI Chat (placeholder — Task 0.7) ──
  ipcMain.handle("ai:chat", async () => {
    throw new Error("AI Engine not yet wired to IPC");
  });
}
