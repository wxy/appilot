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

export function isAllowedRendererNavigation(value: string, devRendererUrl?: string): boolean {
  if (value.startsWith('file://')) return true;
  if (!devRendererUrl) return false;
  try {
    return new URL(value).origin === new URL(devRendererUrl).origin;
  } catch {
    return false;
  }
}
