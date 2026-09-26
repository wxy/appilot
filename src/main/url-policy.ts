/** Electron 导航/外链白名单。保持纯函数，便于不启动 Electron 的单测。 */
export function safeHttpUrl(value: unknown, opts: { httpsOnly?: boolean } = {}): URL | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const parsed = new URL(value);
    const allowed = opts.httpsOnly
      ? parsed.protocol === 'https:'
      : parsed.protocol === 'https:' || parsed.protocol === 'http:';
    return allowed ? parsed : null;
  } catch {
    return null;
  }
}

export function isAllowedAppStorePage(value: unknown): boolean {
  const parsed = safeHttpUrl(value, { httpsOnly: true });
  return parsed !== null && (parsed.hostname === 'apps.apple.com' || parsed.hostname === 'itunes.apple.com');
}

/**
 * AI 供应商端点白名单（审计 M-M2）：主进程会携带真实 API Key 请求该 URL，
 * 必须收紧——允许 https；http 仅限本机回环（Ollama 等本地推理服务），
 * 其余一律拒绝，防渲染层改写 endpoint 后把 Key 外带。
 */
export function isAllowedAiProviderUrl(value: unknown): boolean {
  const parsed = safeHttpUrl(value);
  if (!parsed) return false;
  if (parsed.protocol === 'https:') return true;
  const host = parsed.hostname.toLowerCase();
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1';
}

export function isAllowedRendererNavigation(value: string, devRendererUrl?: string): boolean {
  if (value.startsWith('file://')) return true;
  if (!devRendererUrl) return false;
  try {
    return new URL(value).origin === new URL(devRendererUrl).origin;
  } catch {
    return false;
  }
}
