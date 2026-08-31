export type ReadinessStatus = "pass" | "fail" | "warning" | "unknown";

export interface ReadinessCheckItem {
  id: string;
  label: string;
  status: ReadinessStatus;
  detail: string;
}

export interface ReadinessLocalization {
  language: string;
  locale?: string;
  name: string;
  subtitle: string;
  promotionalText: string;
  keywords: string;
  description: string;
  whatsNew: string;
}

export interface ReadinessInput {
  localizations: ReadinessLocalization[];
  supportedLanguages: string[];
  versionTag: string;
  ascVersion?: string | null;
  buildAttached: boolean;
}

export const STORE_FIELD_LIMITS = {
  name: 30,
  subtitle: 30,
  promotionalText: 170,
  keywords: 100,
  description: 4000,
  whatsNew: 4000,
} as const;

const FIELD_LABELS: Record<keyof typeof STORE_FIELD_LIMITS, string> = {
  name: "名称",
  subtitle: "副标题",
  promotionalText: "Promotional Text",
  keywords: "关键词",
  description: "描述",
  whatsNew: "What's New",
};

function localeMatches(locale: string, code: string): boolean {
  const a = locale.toLowerCase();
  const b = code.toLowerCase();
  return a === b || a.startsWith(b) || b.startsWith(a);
}

export function runReadinessChecks(input: ReadinessInput): ReadinessCheckItem[] {
  const items: ReadinessCheckItem[] = [];
  const localizations = input.localizations || [];

  if (input.supportedLanguages.length === 0) {
    items.push({ id: "localizations", label: "本地化覆盖率", status: "unknown", detail: "产品尚未声明支持语言" });
  } else {
    const missing = input.supportedLanguages.filter(
      (code) => !localizations.some((loc) => localeMatches(loc.locale || loc.language, code)),
    );
    items.push(
      missing.length === 0
        ? { id: "localizations", label: "本地化覆盖率", status: "pass", detail: `已覆盖 ${input.supportedLanguages.length} 种语言` }
        : { id: "localizations", label: "本地化覆盖率", status: "warning", detail: `App Store 缺少本地化：${missing.join("、")}` },
    );
  }

  if (localizations.length === 0) {
    items.push({ id: "limits", label: "字段限制", status: "warning", detail: "尚未生成任何本地化文案" });
  } else {
    for (const loc of localizations) {
      for (const field of Object.keys(STORE_FIELD_LIMITS) as (keyof typeof STORE_FIELD_LIMITS)[]) {
        const value = String(loc[field] || "");
        const limit = STORE_FIELD_LIMITS[field];
        if (value.length > limit) {
          items.push({
            id: `limit:${loc.language}:${field}`,
            label: `${FIELD_LABELS[field]}（${loc.language}）`,
            status: "fail",
            detail: `${value.length}/${limit} 超限`,
          });
        }
      }
    }
  }

  const tagVersion = String(input.versionTag || "").trim().replace(/^v/i, "");
  if (!tagVersion) {
    items.push({ id: "version", label: "版本号匹配", status: "unknown", detail: "尚未填写目标版本，无法比对" });
  } else if (!input.ascVersion) {
    items.push({ id: "version", label: "版本号匹配", status: "unknown", detail: "未回读到 App Store 版本，无法比对" });
  } else if (input.ascVersion === tagVersion) {
    items.push({ id: "version", label: "版本号匹配", status: "pass", detail: `目标版本 v${tagVersion} = App Store ${input.ascVersion}` });
  } else {
    items.push({ id: "version", label: "版本号匹配", status: "fail", detail: `目标版本 v${tagVersion} ≠ App Store ${input.ascVersion}` });
  }

  if (!input.ascVersion) {
    items.push({ id: "build", label: "构建挂载", status: "unknown", detail: "未回读到 App Store 版本，无法检查构建" });
  } else if (input.buildAttached) {
    items.push({ id: "build", label: "构建挂载", status: "pass", detail: `版本 ${input.ascVersion} 已挂载构建` });
  } else {
    items.push({ id: "build", label: "构建挂载", status: "fail", detail: `版本 ${input.ascVersion} 未挂载构建，需在 App Store Connect 上传并挂载` });
  }

  return items;
}
