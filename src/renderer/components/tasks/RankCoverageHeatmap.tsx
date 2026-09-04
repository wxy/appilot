import { useEffect, useState } from "react";
import { storefrontDisplayName } from "@appilot-labs/appilot-core/storefronts";
import { cn } from "../../lib/utils";

/**
 * 排名覆盖热力图（原型确认后落地）：产品 × (语言×商店) 矩阵。
 * 每格点阵 = 关键字每 5 词一桶，点随格宽自动换行居中 → 随页宽自适应。
 * 桶色：绿=全采到 / 黄=部分 / 红=有失败 / 浅灰=未到期 / 橙=过期未采（严格 12h 窗口）。
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
    return () => undefined;
  }, []);
  useEffect(() => {
    const handler = (e: Event) => {
      if ((e as CustomEvent).detail === "tasks") load();
    };
    window.addEventListener("appilot:data-changed", handler);
    return () => window.removeEventListener("appilot:data-changed", handler);
  }, [windowHours]);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [windowHours]);

  if (!matrix) return null;
  const { columns = [], rows = [], generatedAt } = matrix;

  return (
    <div className="mb-6">
      <div className="flex items-baseline justify-between mb-1">
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          排名覆盖热力图
        </h3>
        <span className="text-[11px] text-zinc-400 dark:text-zinc-500">
          每点 = 5 个关键字 · 覆盖窗口
          <select
            value={String(windowHours)}
            onChange={(e) => setWindowHours(Number(e.target.value))}
            className="ml-1 px-1 py-0.5 rounded border border-zinc-300 dark:border-zinc-700 bg-transparent text-[11px] text-zinc-500 dark:text-zinc-400"
            title="成功快照多久以内算已采到（采集为每词 12h 错峰轮转，12h 会常见部分覆盖）"
          >
            {WINDOW_OPTIONS.map((o) => (
              <option key={o.h} value={String(o.h)}>{o.label}</option>
            ))}
          </select>
          {generatedAt ? ` · ${new Date(generatedAt).toLocaleTimeString()}` : ""}
        </span>
      </div>
      <p className="text-[11px] text-zinc-400 dark:text-zinc-500 mb-2">
        产品（仓库 + 平台）× 语言/商店的采集覆盖——悬停格子看关键词明细；绿=覆盖齐，红=有失败需处理
      </p>
      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-2 w-full overflow-x-auto">
        <table className="w-full border-separate" style={{ borderSpacing: 2, tableLayout: "fixed" }}>
          <colgroup>
            <col style={{ width: 150 }} />
            {columns.map((_: any, i: number) => (
              <col key={i} />
            ))}
          </colgroup>
          <thead>
            {/* 第一行：按语言分组（columns 已按 lang 连续排序） */}
            <tr>
              <th rowSpan={2} className="text-[11px] font-semibold text-zinc-500 dark:text-zinc-400 text-left px-1.5 py-1 align-bottom">
                产品
              </th>
              {(() => {
                const heads: any[] = [];
                let i = 0;
                while (i < columns.length) {
                  const lang = columns[i].lang;
                  let j = i;
                  while (j < columns.length && columns[j].lang === lang) j++;
                  heads.push(
                    <th
                      key={"lg:" + lang}
                      colSpan={j - i}
                      className="text-[10px] font-semibold text-zinc-500 dark:text-zinc-400 text-center border-b border-zinc-100 dark:border-zinc-800"
                      title={langLabel(lang)}
                    >
                      {langLabel(lang)}
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
            {rows.map((row: any) => {
              const rowLabel =
                row.projectName && row.platform
                  ? `${row.projectName} · ${PLATFORM_LABEL[row.platform] ?? row.platform}`
                  : row.productId;
              return (
                <tr key={row.productId}>
                  <td
                    className="px-2 py-1 align-middle bg-zinc-50 dark:bg-zinc-800/60 rounded-l-md whitespace-pre-line"
                    title={`${row.productId}${row.productName ? ` · ${row.productName}` : ""}`}
                  >
                    <div className="text-xs font-semibold text-zinc-700 dark:text-zinc-200">
                      {row.projectName || row.productId}
                    </div>
                    <div className="text-[10px] text-zinc-400 dark:text-zinc-500 mt-0.5">
                      {PLATFORM_LABEL[row.platform] ?? row.platform ?? ""}
                    </div>
                  </td>
                  {row.cells.map((cell: any, ci: number) => {
                    if (cell.total === 0) {
                      return (
                        <td key={ci} title="无跟踪任务" style={{ height: 56 }} />
                      );
                    }
                    const col = columns[ci];
                    const tip =
                      `${rowLabel} · ${langLabel(col?.lang)} ${storefrontDisplayName(col?.storefront)} · ${cell.total} 词（${cell.buckets.length} 桶×5）\n` +
                      cell.buckets
                        .map(
                          (b: any) =>
                            `${TONE_LABEL[b.tone] ?? b.tone}: ${b.keywords?.map((k: any) => `${k.keyword}(${k.lang})`).join("、")}`,
                        )
                        .join("\n");
                    return (
                      <td key={ci} title={tip} className="align-middle text-center" style={{ height: 56, minWidth: 36 }}>
                        <div
                          className="flex flex-wrap justify-center content-center gap-[3px]"
                          style={{ minHeight: 44 }}
                        >
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
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-zinc-500 dark:text-zinc-400">
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-[2px] bg-emerald-500 inline-block" />全采到</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-[2px] bg-amber-400 inline-block" />部分</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-[2px] bg-red-500 inline-block" />有失败</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-[2px] bg-zinc-200 dark:bg-zinc-700 inline-block" />未到期</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-[2px] bg-orange-500 inline-block" />过期未采</span>
      </div>
    </div>
  );
}
