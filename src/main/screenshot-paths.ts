/**
 * 截图图片「已知路径」白名单（审计 2026-09-26 M-M4）：
 *
 * release:screenshotImagePreview 会把渲染层给的任意路径图片转成 dataURL
 * 读回——被攻破的渲染层可借它窃取磁盘上任意图片。合法路径只有一种来源：
 * 主进程 dialog（release:selectScreenshotImage）选定后写入草稿的路径。
 * 因此维护一个持久化的「已知路径」集合：选择时登记，预览时校验；集合之外的
 * 路径一律拒绝。集合持久化在 store 里，应用重启后旧草稿的预览仍然可用；
 * 渲染层无法自行向集合注入路径。
 *
 * 纯函数便于不启动 Electron 的单测；路径统一 resolve 后比较，避免相对/
 * 绝对形态绕过。
 */
import path from "path";

/** 集合容量上限：防止长期使用后无限增长（LRU：最新选择在前）。 */
export const KNOWN_SCREENSHOT_IMAGE_PATHS_CAP = 500;

function normalizePath(candidate: unknown): string | null {
  if (typeof candidate !== "string") return null;
  const trimmed = candidate.trim();
  if (!trimmed) return null;
  try {
    return path.resolve(trimmed);
  } catch {
    return null;
  }
}

/** 登记一个新选择的图片路径（去重 + 置顶 + 容量截断），返回新列表。 */
export function rememberKnownImagePath(list: string[], candidate: unknown): string[] {
  const resolved = normalizePath(candidate);
  if (!resolved) return list;
  return [resolved, ...list.filter((item) => item !== resolved)].slice(
    0,
    KNOWN_SCREENSHOT_IMAGE_PATHS_CAP,
  );
}

/** 校验路径是否在已知集合内（resolve 后精确比较）。 */
export function isKnownImagePath(list: string[], candidate: unknown): boolean {
  const resolved = normalizePath(candidate);
  return resolved !== null && list.includes(resolved);
}
