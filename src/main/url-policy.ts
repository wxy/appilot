/** Electron 导航/外链白名单。保持纯函数，便于不启动 Electron 的单测。 */
import path from 'path';

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

/**
 * 主窗口导航白名单。
 * - file: 导航仅放行 allowedFileDir 目录前缀（生产 = 应用自带 renderer 目录，
 *   审计 M-M5：旧实现 `startsWith('file://')` 全放行，可被导航到磁盘任意
 *   本地文件，白名单语义失效）；
 * - dev 环境放行 ELECTRON_RENDERER_URL 同源。
 * 保持纯函数（node:path 可用于单测），便于不启动 Electron 的单测。
 */
export function isAllowedRendererNavigation(
  value: string,
  devRendererUrl?: string,
  allowedFileDir?: string,
): boolean {
  if (value.startsWith('file://')) {
    if (!allowedFileDir) return false;
    try {
      const parsed = new URL(value);
      if (parsed.protocol !== 'file:' || parsed.hostname) return false;
      const filePath = path.resolve(decodeURIComponent(parsed.pathname));
      const allowed = path.resolve(allowedFileDir);
      return filePath === allowed || filePath.startsWith(allowed + path.sep);
    } catch {
      return false;
    }
  }
  if (!devRendererUrl) return false;
  try {
    return new URL(value).origin === new URL(devRendererUrl).origin;
  } catch {
    return false;
  }
}
