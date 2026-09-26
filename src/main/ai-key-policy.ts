import { isAllowedAiProviderUrl } from './url-policy';

/** Bind a saved AI key to the exact provider endpoint, with harmless URL spelling normalized. */
export function sameAiProviderEndpoint(savedUrl: unknown, requestUrl: unknown): boolean {
  if (!isAllowedAiProviderUrl(savedUrl) || !isAllowedAiProviderUrl(requestUrl)) return false;
  const normalized = (value: string): string => {
    const url = new URL(value);
    url.pathname = url.pathname.replace(/\/+$/, '') || '/';
    return url.toString();
  };
  return normalized(savedUrl as string) === normalized(requestUrl as string);
}

/** A blank Key keeps the old secret only while the endpoint stays the same. */
export function shouldPreserveSavedAiKey(savedUrl: unknown, nextUrl: unknown, enteredKey: unknown): boolean {
  return !String(enteredKey || '').trim() && sameAiProviderEndpoint(savedUrl, nextUrl);
}

/** Never send a stored Key to an endpoint supplied by an untrusted renderer. */
export function resolveAiKeyForRequest(
  requestUrl: unknown,
  enteredKey: unknown,
  useStoredKey: boolean,
  savedUrl: unknown,
  savedKey: string,
): string {
  const typed = String(enteredKey || '').trim();
  if (typed) return typed;
  if (!useStoredKey || !savedKey) return '';
  if (!sameAiProviderEndpoint(savedUrl, requestUrl)) {
    throw new Error('已保存的 API Key 仅可用于其原供应商 URL；请为新 URL 输入新的 Key');
  }
  return savedKey.trim();
}
