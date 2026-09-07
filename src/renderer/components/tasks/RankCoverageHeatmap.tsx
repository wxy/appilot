import { useEffect, useState } from "react";
import { storefrontDisplayName } from "@appilot-labs/appilot-core/storefronts";
import { cn } from "../../lib/utils";

/**
 * 排名覆盖热力图（卡片式）：产品 × 商店矩阵，左上角两项切换：
 * - 全局：英语（全局通用检索词）关键词 × 全部商店。首行单一「全局」组头，次行商店。
 * - 各语言：按关键词语言分组（含英语 × 英语地区商店），首行语言组头（按拼音排序），
 *   次行商店。
 * 每格点阵 = 关键字每 4 词一桶，点随格宽自动换行居中 → 随页宽自适应。
 * 桶色：绿=覆盖齐 / 黄=部分 / 红=有失败 / 浅灰=未到期 / 橙=过期未采。
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

/** 语言组头拼音（按拼音排序；分音节比较，前缀音节短者在前，如 法语 fa < 繁体 fan）。 */
const LANG_PINYIN_SYL: Record<string, string[]> = {
  en: ["ying"],
  "zh-Hans": ["jian", "ti", "zhong", "wen"],
  "zh-Hant": ["fan", "ti", "zhong", "wen"],
  ja: ["ri"],
  ko: ["han"],
  de: ["de"],
  fr: ["fa"],
  es: ["xi", "ban", "ya"],
  pt: ["pu", "tao", "ya"],
  ar: ["a", "la", "bo"],
  ru: ["e"],
};
function comparePinyin(a: string, b: string): number {
  const sa = LANG_PINYIN_SYL[a] ?? [];
  const sb = LANG_PINYIN_SYL[b] ?? [];
  return compareSyllableLists(sa, sb);
}

/** 通用音节级拼音比较：前缀音节短者在前（如 fa < fan）。 */
function compareSyllableLists(sa: string[], sb: string[]): number {
  const n = Math.max(sa.length, sb.length);
  for (let i = 0; i < n; i++) {
    const x = sa[i] ?? "";
    const y = sb[i] ?? "";
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

/** 商店（市场）中文名拼音：storefrontDisplayName 用 STOREFRONT_NAMES 中文名，按此排序。 */
const STOREFRONT_PINYIN_SYL: Record<string, string[]> = {
  us: ["mei"],
  gb: ["ying"],
  au: ["ao", "da", "li", "ya"],
  ca: ["jia"],
  nz: ["xin", "xi", "lan"],
  ie: ["ai", "er", "lan"],
  de: ["de"],
  at: ["ao", "di", "li"],
  ch: ["rui"],
  fr: ["fa"],
  be: ["bi", "li", "shi"],
  es: ["xi", "ban", "ya"],
  mx: ["mo", "xi", "ge"],
  ar: ["a", "gen", "ting"],
  cl: ["zhi", "li"],
  it: ["yi", "da", "li"],
  nl: ["he", "lan"],
  br: ["ba", "xi"],
  pt: ["pu", "tao", "ya"],
  jp: ["ri", "ben"],
  kr: ["han", "guo"],
  cn: ["zhong", "guo", "da", "lu"],
  sg: ["xin", "jia", "po"],
  tw: ["tai", "wan"],
  hk: ["xiang", "gang"],
  mo: ["ao", "men"],
  ru: ["e", "luo", "si"],
};
const compareStorefrontPinyin = (codeA: string, codeB: string) =>
  compareSyllableLists(
    STOREFRONT_PINYIN_SYL[String(codeA).toLowerCase()] ?? [String(codeA)],
    STOREFRONT_PINYIN_SYL[String(codeB).toLowerCase()] ?? [String(codeB)],
  );

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

type HeatmapMode = "global" | "langs";

export function RankCoverageHeatmap() {
  const [matrix, setMatrix] = useState<any>(null);
  const [windowHours, setWindowHours] = useState(24);
  // 两项切换：global = 英语（全局）关键词 × 全部商店；langs = 各语言分组视图。
  const [mode, setMode] = useState<HeatmapMode>("global");

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
  const inLangView = mode === "langs";
  // 列筛选：全局 = en（英语）关键词出现的全部商店列；各语言 = local:* 组列
  // （en×英语商店的「英语」组 + 各本地化语言组；en×其他语言商店列归全局视图）。
  const matchMode = (c: any) =>
    inLangView
      ? typeof c.group === "string" && c.group.startsWith("local:")
      : c.lang === "en";
  const colPairs: Array<{ i: number; col: any }> = [];
  for (let i = 0; i < columns.length; i++) {
    if (matchMode(columns[i])) colPairs.push({ i, col: columns[i] });
  }
  // 排序：先语言（拼音），再商店（拼音）。
  let orderedPairs: Array<{ i: number; col: any }>;
  if (inLangView) {
    const byGroup = new Map<string, Array<{ i: number; col: any }>>();
    for (const p of colPairs) {
      const g = p.col.group;
      if (!byGroup.has(g)) byGroup.set(g, []);
      byGroup.get(g)!.push(p);
    }
    const orderedGroups = [...byGroup.keys()].sort(
      (a, b) => comparePinyin(a.slice(6), b.slice(6)) || a.localeCompare(b),
    );
    orderedPairs = [];
    for (const g of orderedGroups) {
      orderedPairs.push(
        ...[...byGroup.get(g)!].sort((a, b) => compareStorefrontPinyin(a.col.storefront, b.col.storefront)),
      );
    }
  } else {
    // 全局：单一语言（en）下的全部商店，按商店拼音排。
    orderedPairs = [...colPairs].sort((a, b) =>
      compareStorefrontPinyin(a.col.storefront, b.col.storefront),
    );
  }
  const visibleColumns = orderedPairs.map((p) => p.col);
  const visibleRows = rows
    .map((row: any) => ({ ...row, cells: orderedPairs.map((p) => row.cells[p.i]) }))
    .filter((row: any) => row.cells.some((c: any) => c && c.total > 0));
  // 各语言视图的语言组头（按拼音排序后的连续段）。
  const langHeads: Array<{ group: string; label: string; span: number }> = [];
  if (inLangView) {
    let i = 0;
    while (i < orderedPairs.length) {
      const g = orderedPairs[i].col.group;
      let j = i;
      while (j < orderedPairs.length && orderedPairs[j].col.group === g) j++;
      langHeads.push({ group: g, label: langLabel(g.slice(6)), span: j - i });
      i = j;
    }
  }

  return (
    <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden shadow-sm">
      <div className="px-6 py-4 border-b border-zinc-100 dark:border-zinc-800 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">排名覆盖热力图</h3>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
            产品（仓库 + 平台）× 商店覆盖 · 左上角切换：全局 = 英语（全局）关键词 × 全部商店
            （含英语与非英语地区）；各语言按关键词语言分组（拼音排序） · 每点 = 4 个关键字
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
                    {/* 左上角：全局 ↔ 各语言切换 */}
                    <th
                      rowSpan={2}
                      className="text-[11px] font-semibold text-zinc-500 dark:text-zinc-400 text-left px-1.5 align-bottom bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-200 dark:border-zinc-700/60"
                    >
                      <div className="flex flex-col items-stretch gap-1">
                        {/* 药丸形切换：全局 ↔ 各语言 */}
                        <div
                          className="flex rounded-full border border-zinc-300 dark:border-zinc-700 p-0.5 gap-0.5"
                          title="切换视图：全局 = 英语（全局）关键词 × 全部商店（含英语与非英语地区）；各语言 = 按关键词语言分组"
                        >
                          {(
                            [
                              ["global", "全局"],
                              ["langs", "各语言"],
                            ] as const
                          ).map(([value, label]) => (
                            <button
                              key={value}
                              type="button"
                              onClick={() => setMode(value)}
                              className={cn(
                                "flex-1 rounded-full px-2 py-0.5 text-[10px] font-medium transition-colors",
                                mode === value
                                  ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                                  : "text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200",
                              )}
                            >
                              {label}
                            </button>
                          ))}
                        </div>
                        <span className="text-[10px] font-semibold text-zinc-400 dark:text-zinc-500">产品</span>
                      </div>
                    </th>
                    {inLangView ? (
                      langHeads.map((h) => (
                        <th
                          key={"g:" + h.group}
                          colSpan={h.span}
                          className="text-[10px] font-semibold text-zinc-500 dark:text-zinc-400 text-center bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-200 dark:border-zinc-700/60"
                          title={`${h.label}关键词 × ${h.span} 个商店`}
                        >
                          {h.label}
                        </th>
                      ))
                    ) : (
                      <th
                        colSpan={visibleColumns.length}
                        className="text-[10px] font-semibold text-zinc-500 dark:text-zinc-400 text-center bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-200 dark:border-zinc-700/60"
                        title="全局：英语（全局通用检索词）关键词 × 全部商店（含英语与非英语地区）"
                      >
                        全局
                        <span className="font-normal text-zinc-400 dark:text-zinc-500"> · {visibleColumns.length} 个商店</span>
                      </th>
                    )}
                  </tr>
                  {/* 第二行：商店全称 */}
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
