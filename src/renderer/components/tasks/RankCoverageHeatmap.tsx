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

const TONE_LABEL: Record<string, string> = {
  cov: "本轮已全采到",
  part: "部分覆盖",
  err: "有失败",
  pend: "未到期（等待）",
  stale: "已到期未采到",
};
const TONE_CLS: Record<string, string> = {
  cov: "bg-emerald-500",
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
  { tone: "cov", label: "覆盖齐" },
  { tone: "part", label: "部分" },
  { tone: "err", label: "有失败" },
  { tone: "pend", label: "未到期" },
  { tone: "stale", label: "过期未采" },
];

export function RankCoverageHeatmap() {
  const [matrix, setMatrix] = useState<any>(null);
  const [windowHours, setWindowHours] = useState(24);

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

  return (
    <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden shadow-sm">
      <div className="px-6 py-4 border-b border-zinc-100 dark:border-zinc-800 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">排名覆盖热力图</h3>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
            产品（仓库 + 平台）× 语言/商店的覆盖——英语×英语商店=「英语」，英语×其他语言商店=「全局」，其余为本地化语言组；每点 = 5 个关键字
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
        ) : (
          <>
            <div className="w-full overflow-x-auto">
              <table className="w-full border-separate" style={{ borderSpacing: 2, tableLayout: "fixed" }}>
                <colgroup>
                  <col style={{ width: 140 }} />
                  {columns.map((_: any, i: number) => (
                    <col key={i} />
                  ))}
                </colgroup>
                <thead>
                  {/* 第一行：按语言分组 */}
                  <tr>
                    <th rowSpan={2} className="text-[11px] font-semibold text-zinc-500 dark:text-zinc-400 text-left px-1.5 align-bottom">
                      产品
                    </th>
                    {(() => {
                      const heads: any[] = [];
                      let i = 0;
                      while (i < columns.length) {
                        const group = columns[i].group;
                        let j = i;
                        while (j < columns.length && columns[j].group === group) j++;
                        const name =
                          group === "global"
                            ? "全局"
                            : group === "local:en"
                              ? "英语"
                              : langLabel(group.replace(/^local:/, ""));
                        heads.push(
                          <th
                            key={"g:" + group}
                            colSpan={j - i}
                            className="text-[10px] font-semibold text-zinc-500 dark:text-zinc-400 text-center border-b border-zinc-100 dark:border-zinc-800"
                            title={
                              group === "global"
                                ? "全局：英语关键词在其他语言商店的查询（英语为全球通用检索词）"
                                : undefined
                            }
                          >
                            {name}
                          </th>,
                        );
                        i = j;
                      }
                      return heads;
                    })()}
                  </tr>
                  {/* 第二行：商店全称 */}
                  <tr>
                    {columns.map((col: any) => (
                      <th
                        key={col.lang + "|" + col.storefront}
                        className="text-[9px] font-medium text-zinc-400 dark:text-zinc-500 px-0.5 text-center"
                      >
                        {storefrontDisplayName(col.storefront)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row: any) => (
                    <tr key={row.productId}>
                      <td
                        className="px-2 py-1 align-middle bg-zinc-50 dark:bg-zinc-800/60 rounded-l-md"
                        title={`${row.productId}${row.productName ? ` · ${row.productName}` : ""}`}
                      >
                        <div className="text-xs font-semibold text-zinc-700 dark:text-zinc-200 whitespace-nowrap">
                          {row.projectName || row.productId}
                        </div>
                        <div className="text-[10px] text-zinc-400 dark:text-zinc-500 mt-0.5">
                          {PLATFORM_LABEL[row.platform] ?? row.platform ?? ""}
                        </div>
                      </td>
                      {row.cells.map((cell: any, ci: number) => {
                        if (cell.total === 0) {
                          return <td key={ci} title="无跟踪任务" style={{ height: 56 }} />;
                        }
                        const col = columns[ci];
                        const tip =
                          `${row.projectName || row.productId} · ${langLabel(col?.lang)} ${storefrontDisplayName(col?.storefront)} · ${cell.total} 词（${cell.buckets.length} 桶×5）\n` +
                          cell.buckets
                            .map(
                              (b: any) =>
                                `${TONE_LABEL[b.tone] ?? b.tone}: ${b.keywords?.map((k: any) => `${k.keyword}(${k.lang})`).join("、")}`,
                            )
                            .join("\n");
                        return (
                          <td key={ci} title={tip} className="align-middle text-center" style={{ height: 56, minWidth: 34 }}>
                            <div className="flex flex-wrap justify-center content-center gap-[3px]" style={{ minHeight: 44 }}>
                              {cell.buckets.map((b: any, bi: number) => (
                                <span
                                  key={bi}
                                  title={TONE_LABEL[b.tone] ?? b.tone}
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
