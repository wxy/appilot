import { useEffect, useState } from "react";
import { cn } from "../../lib/utils";

/**
 * 排名覆盖热力图（原型确认后落地）：产品 × 商店矩阵，
 * 每格点阵 = 关键字每 5 词一桶，统一 4 列网格居中 → 热力毯。
 * 桶色：绿=全采到 / 黄=部分 / 红=有失败 / 浅灰=未到期 / 橙=过期未采（严格 12h 窗口）。
 * 语义：回答「哪些市场的排名关键词覆盖齐全、哪里掉队」——与时间线（流量）互补。
 */

const CELL_COLS = 4;
const TONE_LABEL: Record<string, string> = {
  cov: "本轮已全采到",
  part: "部分覆盖",
  err: "有失败",
  pend: "未到期（等待）",
  stale: "已到期未采到",
};

export function RankCoverageHeatmap() {
  const [matrix, setMatrix] = useState<any>(null);

  const load = () => {
    (window as any).appilot?.scheduler?.matrix()
      .then(setMatrix)
      .catch(() => undefined);
  };
  useEffect(() => {
    load();
    return () => undefined;
  }, []);

  // 随页面 15s 轮询由父级定期刷新（通过 data-changed 触发主链路后再刷一次矩阵）
  useEffect(() => {
    const handler = (e: Event) => {
      if ((e as CustomEvent).detail === "tasks") load();
    };
    window.addEventListener("appilot:data-changed", handler);
    return () => window.removeEventListener("appilot:data-changed", handler);
  }, []);

  if (!matrix) return null;
  const { storefronts = [], rows = [], generatedAt } = matrix;

  return (
    <div className="mb-6">
      <div className="flex items-baseline justify-between mb-1">
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          排名覆盖热力图
        </h3>
        <span className="text-[11px] text-zinc-400 dark:text-zinc-500">
          每点 = 5 个关键字 · 严格 12h 窗口
          {generatedAt ? ` · ${new Date(generatedAt).toLocaleTimeString()}` : ""}
        </span>
      </div>
      <p className="text-[11px] text-zinc-400 dark:text-zinc-500 mb-2">
        产品 × 商店的采集覆盖——悬停格子看该商店关键词明细；绿=覆盖齐，红=有失败需处理
      </p>
      <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-2 inline-block max-w-full">
        <table className="border-separate" style={{ borderSpacing: 2 }}>
          <thead>
            <tr>
              <th
                className="text-[10px] font-medium text-zinc-400 dark:text-zinc-500 text-left px-1 py-1"
              >
                产品 \ 商店
              </th>
              {storefronts.map((sf: string) => (
                <th
                  key={sf}
                  className="text-[10px] font-medium text-zinc-400 dark:text-zinc-500 px-0.5"
                  style={{ writingMode: "vertical-rl", transform: "rotate(180deg)", height: 70 }}
                >
                  {sf}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row: any) => (
              <tr key={row.productId}>
                <td
                  className="text-xs font-semibold text-zinc-700 dark:text-zinc-200 px-2 py-1 align-middle bg-zinc-50 dark:bg-zinc-800/60 whitespace-pre-line rounded-l-md"
                >
                  {row.productId}
                  {row.productName ? `\n${row.productName}` : ""}
                </td>
                {row.cells.map((cell: any) => {
                  const dotSpan = (b: any) => (
                    <span
                      key={cell.storefront + ":" + b.keywords?.map((k: any) => k.keyword).join(",")}
                      className={cn(
                        "inline-block w-2 h-2 rounded-[2px]",
                        b.tone === "cov" && "bg-emerald-500",
                        b.tone === "part" && "bg-amber-400",
                        b.tone === "err" && "bg-red-500",
                        b.tone === "pend" && "bg-zinc-200 dark:bg-zinc-700",
                        b.tone === "stale" && "bg-orange-500",
                      )}
                    />
                  );
                  if (cell.total === 0) {
                    return <td key={cell.storefront} className="bg-zinc-100 dark:bg-zinc-800/40 rounded-[4px]" style={{ width: 48, height: 64 }} />;
                  }
                  const tip =
                    `${row.productId} · ${cell.storefront} · ${cell.total} 词（${cell.buckets.length} 桶×5）\n` +
                    cell.buckets
                      .map((b: any) => `${TONE_LABEL[b.tone] ?? b.tone}: ${b.keywords?.map((k: any) => `${k.keyword}(${k.lang})`).join("、")}`)
                      .join("\n");
                  return (
                    <td
                      key={cell.storefront}
                      title={tip}
                      className="align-middle text-center bg-white dark:bg-zinc-900"
                      style={{ width: 8 * CELL_COLS + 4 * (CELL_COLS - 1) + 12, height: 64 }}
                    >
                      <div
                        className="grid place-content-center"
                        style={{
                          height: "100%",
                          gridTemplateColumns: `repeat(${CELL_COLS}, 8px)`,
                          gap: 4,
                        }}
                      >
                        {cell.buckets.map((b: any) => dotSpan(b))}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
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
