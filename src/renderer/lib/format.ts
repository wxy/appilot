/**
 * Shared display formatters (pure, no React/Electron deps).
 */

const LANGUAGE_LABELS: Record<string, string> = {
  en: "英文",
  de: "德文",
  fr: "法文",
  es: "西班牙文",
  it: "意大利文",
  nl: "荷兰文",
  pt: "葡萄牙文",
  "pt-BR": "巴西葡萄牙文",
  ja: "日文",
  ko: "韩文",
  "zh-Hans": "简体中文",
  "zh-Hant": "繁体中文",
  ru: "俄文",
};

export const UI_SOURCE_LANGUAGE = "zh-Hans";

export function languageLabel(code: string): string {
  return LANGUAGE_LABELS[code] || code;
}

export function platformLabel(platform: string): string {
  if (platform === "ios") return "iOS";
  if (platform === "macos") return "macOS";
  return "未识别";
}

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

export function formatHumanTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const target = new Date(iso);
  const now = new Date();
  const diffMs = target.getTime() - now.getTime();
  const absMs = Math.abs(diffMs);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (absMs < minute) return diffMs >= 0 ? "即将" : "刚刚";
  if (absMs < hour) {
    const count = Math.round(absMs / minute);
    return diffMs >= 0 ? `${count} 分钟后` : `${count} 分钟前`;
  }
  if (absMs < day) {
    const count = Math.round(absMs / hour);
    return diffMs >= 0 ? `${count} 小时后` : `${count} 小时前`;
  }

  const dayDiff = Math.round((startOfDay(target) - startOfDay(now)) / day);
  if (dayDiff === 1) return "明天";
  if (dayDiff === 2) return "后天";
  if (dayDiff === -1) return "昨天";
  if (dayDiff === -2) return "前天";
  if (dayDiff > 2 && dayDiff <= 7) return `${dayDiff} 天后`;
  if (dayDiff < -2 && dayDiff >= -7) return `${Math.abs(dayDiff)} 天前`;

  const monthDiff =
    (target.getFullYear() - now.getFullYear()) * 12 + (target.getMonth() - now.getMonth());
  if (monthDiff === 1) return "下个月";
  if (monthDiff === -1) return "上个月";
  if (monthDiff > 1) return `${monthDiff} 个月后`;
  if (monthDiff < -1) return `${Math.abs(monthDiff)} 个月前`;

  return target.toLocaleDateString();
}

export function formatDurationMs(ms?: number | null): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${Math.round(ms)} 毫秒`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} 秒`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return `${minutes} 分 ${seconds} 秒`;
}

export function formatKilo(chars: number): string {
  return `${(chars / 1000).toFixed(1).replace(/\.0$/, "")}K字`;
}

export function formatTokens(n: number): string {
  if (n < 1000) return `${Math.round(n)}`;
  return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}K`;
}

export function formatBytes(bytes: number): string {
  if (!bytes) return "0B";
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

export function formatDuration(ms: number): string {
  if (!ms) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds}秒`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}分${s > 0 ? `${String(s).padStart(2, "0")}秒` : ""}`;
}
