import { useCallback, useEffect, useRef, useState } from "react";
import { useTheme } from "../../stores/theme";
import { btnPrimary, btnSecondary, inputClass } from "../ui/styles";
import { CredentialsForm } from "./CredentialsForm";

const AI_PRESETS = [
  { label: "OpenAI", url: "https://api.openai.com/v1", model: "gpt-4o" },
  { label: "OpenAI (Mini)", url: "https://api.openai.com/v1", model: "gpt-4o-mini" },
  { label: "DeepSeek", url: "https://api.deepseek.com", model: "deepseek-v4-flash" },
  { label: "Groq", url: "https://api.groq.com/openai/v1", model: "llama-3.3-70b-versatile" },
  { label: "Ollama (Local)", url: "http://localhost:11434/v1", model: "llama3" },
  { label: "Custom", url: "", model: "" },
];

export function SettingsPage() {
  const { theme, setTheme } = useTheme();
  const [preset, setPreset] = useState("OpenAI");
  const [providerUrl, setProviderUrl] = useState("https://api.openai.com/v1");
  const [apiKey, setApiKey] = useState("");
  const [showApiKey, setShowApiKey] = useState(false);
  const [apiKeyBroken, setApiKeyBroken] = useState(false);
  const [model, setModel] = useState("gpt-4o");
  const [models, setModels] = useState<string[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState("");
  const [modelCustom, setModelCustom] = useState(false);
  const [testing, setTesting] = useState(false);
  const [status, setStatus] = useState<"idle" | "success" | "error">("idle");
  const [statusMsg, setStatusMsg] = useState("");

  useEffect(() => {
    (window as any).appilot?.ai?.getConfig().then((c: any) => {
      if (c?.providerUrl) setProviderUrl(c.providerUrl);
      if (c?.apiKey) setApiKey(c.apiKey);
      if (c?.model) setModel(c.model);
      setApiKeyBroken(Boolean(c?.apiKeyBroken));
    }).catch(() => {});
  }, []);

  const listModels = useCallback(async (url: string, key: string) => {
    if (!url.trim()) return;
    setModelsLoading(true);
    setModelsError("");
    try {
      const result = await (window as any).appilot?.ai?.listModels({ providerUrl: url, apiKey: key });
      const list = Array.isArray(result?.models) ? result.models : [];
      setModels(list);
      if (list.length === 0 && result?.error) setModelsError(result.error);
    } catch (e: any) {
      setModelsError(e.message || "模型列表获取失败");
    } finally {
      setModelsLoading(false);
    }
  }, []);

  // Discover the provider's supported models whenever URL or key changes
  // (debounced; the very first render with defaults is skipped).
  const didInitModels = useRef(false);
  useEffect(() => {
    if (!didInitModels.current) {
      didInitModels.current = true;
      return;
    }
    if (!providerUrl.trim()) return;
    const timer = window.setTimeout(() => void listModels(providerUrl, apiKey), 400);
    return () => window.clearTimeout(timer);
  }, [providerUrl, apiKey, listModels]);

  // Keep the preset selector in sync with the actual URL + model: prefer an
  // exact URL+model match, fall back to a URL match, otherwise Custom.
  useEffect(() => {
    const exact = AI_PRESETS.find((p) => p.url === providerUrl && p.model === model);
    const byUrl = AI_PRESETS.find((p) => p.url === providerUrl);
    setPreset((prev) => {
      const prevMatch = AI_PRESETS.find((p) => p.label === prev);
      if (prevMatch && prevMatch.url === providerUrl && prevMatch.model === model) return prev;
      return (exact || byUrl)?.label || "Custom";
    });
  }, [providerUrl, model]);

  const handlePresetChange = (label: string) => {
    setPreset(label);
    const p = AI_PRESETS.find((p) => p.label === label);
    // Selecting a provider only sets its endpoint; the supported models are
    // discovered from the provider API (see the model field below).
    if (p && p.label !== "Custom") setProviderUrl(p.url);
  };

  const handleSave = async () => {
    try {
      await (window as any).appilot?.ai?.saveConfig({ providerUrl, apiKey, model });
      const refreshed = await (window as any).appilot?.ai?.getConfig().catch(() => null);
      if (refreshed) setApiKeyBroken(Boolean(refreshed.apiKeyBroken));
      setStatus("success"); setStatusMsg("已保存");
      setTimeout(() => setStatus("idle"), 2000);
    } catch (e: any) { setStatus("error"); setStatusMsg(e.message || "保存失败"); }
  };

  const handleTest = async () => {
    setTesting(true); setStatus("idle");
    try {
      const result = await (window as any).appilot?.ai?.testConnection({ providerUrl, apiKey, model });
      const ok = result?.ok ?? false;
      setStatus(ok ? "success" : "error");
      setStatusMsg(ok ? "连接成功" : result?.error ? `连接失败：${result.error}` : "连接失败");
    } catch (e: any) { setStatus("error"); setStatusMsg(e.message || "出错"); }
    finally { setTesting(false); }
  };

  return (
    <div className="p-10 max-w-2xl mx-auto">
      <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100 mb-2">设置</h2>
      <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-8">配置 AI 供应商以启用分析能力。</p>

      <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden mb-8 shadow-sm">
        <div className="px-6 py-4 border-b border-zinc-100 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/50">
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">AI 供应商</h3>
        </div>
        <div className="p-6 space-y-5">
          <div>
            <label className="block text-[13px] font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">供应商</label>
            <select value={preset} onChange={(e) => handlePresetChange(e.target.value)} className={inputClass}>
              {AI_PRESETS.map((p) => <option key={p.label} value={p.label}>{p.label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[13px] font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">URL</label>
            <input type="text" value={providerUrl} onChange={(e) => setProviderUrl(e.target.value)} className={inputClass} />
          </div>
          <div>
            <label className="block text-[13px] font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">API Key</label>
            <div className="relative">
              <input
                type={showApiKey ? "text" : "password"}
                value={apiKey}
                onChange={(e) => {
                  setApiKey(e.target.value);
                  setApiKeyBroken(false);
                }}
                className={inputClass + " pr-10"}
                placeholder="sk-..."
                autoComplete="off"
              />
              <button
                type="button"
                onClick={() => setShowApiKey((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 w-7 h-7 flex items-center justify-center rounded-md text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
                title={showApiKey ? "隐藏 API Key" : "显示 API Key"}
                aria-label={showApiKey ? "隐藏 API Key" : "显示 API Key"}
              >
                {showApiKey ? (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
                    <path d="M3 3l18 18" />
                    <path d="M10.6 5.1A9.8 9.8 0 0 1 12 5c6.5 0 10 7 10 7a17.9 17.9 0 0 1-2.9 3.9M6.6 6.6A16.3 16.3 0 0 0 2 12s3.5 7 10 7a9.6 9.6 0 0 0 4.4-1.1" />
                    <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
                    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                )}
              </button>
            </div>
            {apiKeyBroken && (
              <p className="text-[11px] text-red-500 dark:text-red-400 mt-1.5">
                已保存的 API Key 无法解密（可能曾被多次加密或系统钥匙串异常），请重新粘贴真实的 Key 后保存。
              </p>
            )}
          </div>
          <div>
            <label className="block text-[13px] font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">模型</label>
            <div className="flex gap-2">
              {models.length > 0 && !modelCustom ? (
                <select
                  value={models.includes(model) ? model : ""}
                  onChange={(e) => {
                    if (e.target.value === "__custom__") setModelCustom(true);
                    else setModel(e.target.value);
                  }}
                  className={inputClass}
                >
                  {!models.includes(model) && <option value="">请选择模型</option>}
                  {models.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                  <option value="__custom__">自定义…</option>
                </select>
              ) : (
                <input
                  type="text"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  className={inputClass}
                  placeholder="模型名称"
                />
              )}
              <button
                type="button"
                onClick={() => listModels(providerUrl, apiKey)}
                disabled={modelsLoading}
                className={btnSecondary + " shrink-0 px-3"}
                title="刷新模型列表"
              >
                {modelsLoading ? "…" : "⟳"}
              </button>
            </div>
            {modelCustom && models.length > 0 && (
              <button
                type="button"
                onClick={() => setModelCustom(false)}
                className="mt-1.5 text-xs text-amber-600 dark:text-amber-400 hover:underline"
              >
                从列表选择模型
              </button>
            )}
            {modelsLoading && (
              <p className="text-[11px] text-zinc-400 dark:text-zinc-500 mt-1.5">正在获取模型列表…</p>
            )}
            {!modelsLoading && models.length > 0 && (
              <p className="text-[11px] text-zinc-400 dark:text-zinc-500 mt-1.5">
                该服务商支持 {models.length} 个模型
              </p>
            )}
            {!modelsLoading && modelsError && (
              <p className="text-[11px] text-amber-600 dark:text-amber-500 mt-1.5">
                模型列表获取失败：{modelsError}（可手动输入模型名）
              </p>
            )}
          </div>
          <div className="flex gap-3 items-center pt-1">
            <button onClick={handleSave} className={btnPrimary}>保存</button>
            <button onClick={handleTest} disabled={testing} className={btnSecondary}>{testing ? "测试中..." : "测试连接"}</button>
            {status !== "idle" && (
              <span className={`text-[13px] font-medium flex items-center gap-1.5 ${status === "success" ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
                <span className="w-1.5 h-1.5 rounded-full bg-current inline-block" />
                {statusMsg}
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden shadow-sm mb-8">
        <div className="px-6 py-4 border-b border-zinc-100 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/50">
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">全局项目凭据</h3>
        </div>
        <div className="p-6">
          <p className="text-[11px] text-zinc-400 dark:text-zinc-500 mb-4">
            适用于所有项目的 GitHub / App Store Connect 凭据；单个项目可在「项目设置」中用本项目凭据覆盖。凭据加密存储，仅用于本地读取增强，不进入 AI 提示词。
          </p>
          <CredentialsForm projectId="" scope="global" />
        </div>
      </div>

      <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden shadow-sm mb-8">
        <div className="px-6 py-4 border-b border-zinc-100 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/50">
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">外观</h3>
        </div>
        <div className="p-6">
          <select value={theme} onChange={(e) => setTheme(e.target.value as any)} className={inputClass + " max-w-xs"}>
            <option value="light">浅色</option>
            <option value="dark">深色</option>
            <option value="system">跟随系统</option>
          </select>
        </div>
      </div>

      <p className="text-[11px] text-zinc-400 dark:text-zinc-500">Appilot · Phase A</p>
    </div>
  );
}

/* ── App Root ── */
