import { ipcMain, shell } from "electron";
import Store from "electron-store";
import { AIProvider } from "../engine/ai/ai-provider";

const store = new Store<{
  aiProviderUrl: string;
  aiApiKey: string;
  aiModel: string;
}>({
  defaults: {
    aiProviderUrl: "https://api.openai.com/v1",
    aiApiKey: "",
    aiModel: "gpt-4o",
  },
});

export function registerIpcHandlers() {
  // ── Shell ──
  ipcMain.handle("shell:openExternal", (_event, url: string) => {
    return shell.openExternal(url);
  });

  // ── AI Config ──
  ipcMain.handle("ai:getConfig", () => ({
    providerUrl: store.get("aiProviderUrl"),
    apiKey: store.get("aiApiKey"),
    model: store.get("aiModel"),
  }));

  ipcMain.handle("ai:saveConfig", (_event, config: { providerUrl: string; apiKey: string; model: string }) => {
    store.set("aiProviderUrl", config.providerUrl);
    store.set("aiApiKey", config.apiKey);
    store.set("aiModel", config.model);
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

  // ── Database (placeholder — wired when needed) ──
  ipcMain.handle("db:query", async () => {
    throw new Error("Database not yet wired to IPC");
  });

  // ── AI Chat (placeholder — wired in Task 0.7) ──
  ipcMain.handle("ai:chat", async () => {
    throw new Error("AI Engine not yet wired to IPC");
  });
}
