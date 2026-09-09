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

/** 紧凑计数（密集小卡/指标用）：1234 → "1.2k"，12000 → "12k"，99 → "99"。 */
export function formatCompactNumber(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs < 1000) return String(Math.round(n));
  const k = n / 1000;
  const body = k >= 100 ? String(Math.round(k)) : k.toFixed(1).replace(/\.0$/, "");
  return `${body}k`;
}

/** 紧凑运行时长（密集小卡/指标用）：45s / 12m / 3h 12m / 2d 5h。 */
export function formatUptimeShort(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hour = Math.floor(min / 60);
  const restMin = min % 60;
  if (hour < 24) return restMin > 0 ? `${hour}h ${restMin}m` : `${hour}h`;
  const day = Math.floor(hour / 24);
  const restHour = hour % 24;
  return restHour > 0 ? `${day}d ${restHour}h` : `${day}d`;
}
