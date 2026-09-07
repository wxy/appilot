import { useEffect, useState } from "react";
import { storefrontDisplayName } from "@appilot-labs/appilot-core/storefronts";
import { cn } from "../../lib/utils";

/**
 * 排名覆盖热力图（卡片式）：产品 × (语言×商店) 矩阵。
 * 每格点阵 = 关键字每 5 词一桶，点随格宽自动换行居中 → 随页宽自适应。
 * 桶色：绿=覆盖齐 / 黄=部分 / 红=有失败 / 浅灰=未到期 / 橙=过期未采。
 * 说明与图例收进卡片内（与执行时间线卡片同构）。
 */

const LANG_LABEL: Record<string, string> = {
  en: "英语",
  "zh-Hans": "简体中文",
  "zh-Hant": "繁体中文",
  ja: "日语",
  ko: "韩语",
  de: "德语",
  fr: "法语",
  es: "西班牙语",
  pt: "葡萄牙语",
  ar: "阿拉伯语",
  ru: "俄语",
};
const langLabel = (l: string) => LANG_LABEL[l] ?? l;
const PLATFORM_LABEL: Record<string, string> = { ios: "iOS", macos: "macOS" };

const TONE_CLS: Record<string, string> = {
  cov: "bg-emerald-500",
  half: "bg-teal-400",
  part: "bg-amber-400",
  err: "bg-red-500",
  pend: "bg-zinc-200 dark:bg-zinc-700",
  stale: "bg-orange-500",
};

const WINDOW_OPTIONS = [
  { h: 12, label: "严格 12h" },
  { h: 24, label: "24h" },
  { h: 48, label: "48h" },
];

const LEGEND: Array<{ tone: string; label: string }> = [
  { tone: "cov", label: "已全采" },
  { tone: "half", label: "过半" },
  { tone: "part", label: "未过半" },
  { tone: "err", label: "有失败" },
  { tone: "pend", label: "未到期" },
  { tone: "stale", label: "过期未采" },
];

export function RankCoverageHeatmap() {
  const [matrix, setMatrix] = useState<any>(null);
  const [windowHours, setWindowHours] = useState(24);
  // 视图：global = 英语关键词 × 全部商店；语言码 = 该语言关键词组（含英语×英语商店）。
  const [mode, setMode] = useState("global");

  const load = (wh: number = windowHours) => {
    (window as any).appilot?.scheduler?.matrix({ windowHours: wh })
      .then(setMatrix)
      .catch(() => undefined);
  };
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [windowHours]);
  useEffect(() => {
    const handler = (e: Event) => {
      if ((e as CustomEvent).detail === "tasks") load();
    };
    window.addEventListener("appilot:data-changed", handler);
    return () => window.removeEventListener("appilot:data-changed", handler);
  }, [windowHours]);

  const { columns = [], rows = [], generatedAt } = matrix ?? {};
  // 视图选项：全局（有任一 en 列）→ 英语 → 其余关键词语言（按常见优先级排序）。
  const modeOptions = (() => {
    const langs = new Set<string>();
    let hasEn = false;
    for (const c of columns) {
      if (c.lang === "en") hasEn = true;
      if (typeof c.group === "string" && c.group.startsWith("local:")) langs.add(c.group.slice(6));
    }
    const priority = ["en", "zh-Hans", "zh-Hant", "ja", "ko", "de", "fr", "es", "pt", "ar", "ru"];
    const ordered = [...langs].sort((a, b) => {
      const ia = priority.indexOf(a);
      const ib = priority.indexOf(b);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
    });
    const out: Array<{ value: string; label: string }> = [];
    if (hasEn) out.push({ value: "global", label: "全局" });
    for (const l of ordered) out.push({ value: l, label: langLabel(l) });
    return out;
  })();
  // 当前生效视图（数据里没有该选项时回落第一个，如无 en 数据的全局）。
  const activeMode =
    mode === "global" || modeOptions.some((o) => o.value === mode) ? mode : modeOptions[0]?.value ?? "global";
  const isGlobal = activeMode === "global";
  // 全局 = en 关键词 × 全部商店（英语商店 + 其他语言商店合并）；语言 = 原 local:* 组。
  const visibleIndexes: number[] = [];
  for (let i = 0; i < columns.length; i++) {
    const c = columns[i];
    if (isGlobal ? c.lang === "en" : c.group === "local:" + activeMode) visibleIndexes.push(i);
  }
  const visibleColumns = visibleIndexes.map((i) => columns[i]);
  const visibleRows = rows
    .map((row: any) => ({ ...row, cells: visibleIndexes.map((i) => row.cells[i]) }))
    .filter((row: any) => row.cells.some((c: any) => c && c.total > 0));
  const modeTitle = isGlobal
    ? "全局：英语关键词 × 全部商店（含英语地区商店）——跨市场通用检索词的覆盖"
    : `${langLabel(activeMode)}关键词 × 该语言跟踪的商店`;
  const modeLabel = isGlobal ? "全局" : langLabel(activeMode);

  return (
    <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden shadow-sm">
      <div className="px-6 py-4 border-b border-zinc-100 dark:border-zinc-800 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">排名覆盖热力图</h3>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
            产品（仓库 + 平台）× 商店覆盖 · 左上角切换：全局 = 英语关键词 × 全部商店
            （含英语地区，跨市场通用检索词），其余按关键词语言分组 · 每点 = 4 个关键字
            {generatedAt ? ` · ${new Date(generatedAt).toLocaleTimeString()}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
          覆盖窗口
          <select
            value={String(windowHours)}
            onChange={(e) => setWindowHours(Number(e.target.value))}
            className="px-1.5 py-0.5 rounded border border-zinc-300 dark:border-zinc-700 bg-transparent text-[11px] text-zinc-500 dark:text-zinc-400"
            title="成功快照多久以内算已采到（采集为每词 12h 错峰轮转，严格 12h 会常见部分覆盖）"
          >
            {WINDOW_OPTIONS.map((o) => (
              <option key={o.h} value={String(o.h)}>{o.label}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="px-4 py-3">
        {!matrix ? (
          <p className="text-xs text-zinc-400 dark:text-zinc-500 py-6 text-center">正在载入覆盖数据…</p>
        ) : visibleColumns.length === 0 ? (
          <p className="text-xs text-zinc-400 dark:text-zinc-500 py-6 text-center">该视图暂无跟踪数据</p>
        ) : (
          <>
            <div className="w-full overflow-x-auto">
              <table className="w-full border-separate" style={{ borderSpacing: 2, tableLayout: "fixed" }}>
                <colgroup>
                  <col style={{ width: 140 }} />
                  {visibleColumns.map((_: any, i: number) => (
                    <col key={i} />
                  ))}
                </colgroup>
                <thead>
                  <tr>
                    {/* 左上角：视图切换（全局 ↔ 各语言） */}
                    <th
                      rowSpan={2}
                      className="text-[11px] font-semibold text-zinc-500 dark:text-zinc-400 text-left px-1.5 align-bottom bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-200 dark:border-zinc-700/60"
                    >
                      <div className="flex flex-col items-stretch gap-1">
                        <select
                          value={activeMode}
                          onChange={(e) => setMode(e.target.value)}
                          className="w-full px-1 py-0.5 rounded border border-zinc-300 dark:border-zinc-700 bg-transparent text-[10px] font-medium text-zinc-700 dark:text-zinc-200"
                          title="切换视图：全局 = 英语关键词 × 全部商店（含英语地区商店）；其余按关键词语言分组"
                        >
                          {modeOptions.map((o) => (
                            <option key={o.value} value={o.value}>{o.label}</option>
                          ))}
                        </select>
                        <span className="text-[10px] font-semibold text-zinc-400 dark:text-zinc-500">产品</span>
                      </div>
                    </th>
                    <th
                      colSpan={visibleColumns.length}
                      className="text-[10px] font-semibold text-zinc-500 dark:text-zinc-400 text-center bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-200 dark:border-zinc-700/60"
                      title={modeTitle}
                    >
                      {modeLabel}
                      <span className="font-normal text-zinc-400 dark:text-zinc-500"> · {visibleColumns.length} 个商店</span>
                    </th>
                  </tr>
                  <tr>
                    {visibleColumns.map((col: any) => (
                      <th
                        key={col.lang + "|" + col.storefront}
                        className="text-[9px] font-medium text-zinc-500 dark:text-zinc-400 px-0.5 text-center bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-200 dark:border-zinc-700/60"
                      >
                        {storefrontDisplayName(col.storefront)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.map((row: any) => (
                    <tr key={row.productId}>
                      <td className="px-2 py-1 align-middle bg-zinc-50 dark:bg-zinc-800/60 rounded-l-md">
                        <div className="text-xs font-semibold text-zinc-700 dark:text-zinc-200 whitespace-nowrap">
                          {row.projectName || row.productId}
                        </div>
                        <div className="text-[10px] text-zinc-400 dark:text-zinc-500 mt-0.5">
                          {PLATFORM_LABEL[row.platform] ?? row.platform ?? ""}
                        </div>
                      </td>
                      {row.cells.map((cell: any, ci: number) => {
                        if (cell.total === 0) {
                          return <td key={ci} style={{ height: 56 }} />;
                        }
                        return (
                          <td key={ci} className="align-middle text-center border border-zinc-100 dark:border-zinc-800/60" style={{ height: 56, minWidth: 34 }}>
                            <div className="flex flex-wrap justify-center content-center gap-[3px]" style={{ minHeight: 44 }}>
                              {cell.buckets.map((b: any, bi: number) => (
                                <span
                                  key={bi}
                                  className={cn("inline-block w-2 h-2 rounded-[2px]", TONE_CLS[b.tone] ?? "bg-zinc-300")}
                                />
                              ))}
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-2 pt-2 border-t border-zinc-100 dark:border-zinc-800 flex flex-wrap gap-3 text-[11px] text-zinc-500 dark:text-zinc-400">
              {LEGEND.map((l) => (
                <span key={l.tone} className="flex items-center gap-1">
                  <span className={cn("w-2 h-2 rounded-[2px] inline-block", TONE_CLS[l.tone])} />
                  {l.label}
                </span>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
