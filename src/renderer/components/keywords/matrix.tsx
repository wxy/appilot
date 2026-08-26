import type { MatrixCell } from "../../lib/matrix";
import { cn } from "../../lib/utils";
import { ValueFlash } from "../ui/ValueFlash";

export function matrixRankText(cell: MatrixCell): string {
  if (cell.beyond200) return "200+";
  return cell.rank != null ? String(cell.rank) : "—";
}

export function matrixTrendText(cell: MatrixCell): string | null {
  return cell.trend === "new" ? "进榜"
    : cell.trend === "lost" ? "掉榜"
    : cell.trend === "up" ? `▲ ${cell.delta}`
    : cell.trend === "down" ? `▼ ${Math.abs(cell.delta ?? 0)}`
    : null;
}

export function MatrixCellView({ cell }: { cell: MatrixCell }) {
  const rankText = matrixRankText(cell);
  const trendText = matrixTrendText(cell);
  return (
    <span className="inline-flex items-baseline gap-1 justify-end">
      <ValueFlash
        value={cell.rank}
        mode="box"
        className={cn(
          "font-mono",
          cell.rank !== null && cell.rank <= 10
            ? "text-amber-600 dark:text-amber-400 font-semibold"
            : "text-zinc-600 dark:text-zinc-300",
        )}
      >
        {rankText}
      </ValueFlash>
      {trendText && (
        <span
          className={cn(
            "text-[10px] font-mono",
            cell.trend === "up" || cell.trend === "new"
              ? "text-emerald-600 dark:text-emerald-400"
              : "text-red-600 dark:text-red-400",
          )}
        >
          {trendText}
        </span>
      )}
    </span>
  );
}

export function RankTooltip({ active, payload, label }: any) {
  if (!active || !Array.isArray(payload)) return null;
  const rows = payload.filter((item: any) => item.value != null);
  if (rows.length === 0) return null;
  const date = new Date(label);
  const labelText = Number.isNaN(date.getTime())
    ? String(label)
    : `${date.toLocaleDateString()} ${date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  return (
    <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-xs shadow-md">
      <p className="mb-1 font-medium text-zinc-500 dark:text-zinc-400">{labelText}</p>
      {rows.map((item: any) => (
        <p key={item.dataKey} className="flex items-center gap-1.5 text-zinc-700 dark:text-zinc-300">
          <span
            className="inline-block w-2 h-2 rounded-full shrink-0"
            style={{ backgroundColor: item.stroke || item.color }}
          />
          {item.name}：第 {item.value} 名
        </p>
      ))}
    </div>
  );
}

export function ChartTick({ x, y, payload }: any) {
  const date = new Date(payload.value);
  if (Number.isNaN(date.getTime())) return null;
  return (
    <text x={x} y={y} textAnchor="middle" fill="#71717a" fontSize={10}>
      <tspan x={x} dy={20}>{date.toLocaleDateString()}</tspan>
      <tspan x={x} dy={12}>{date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</tspan>
    </text>
  );
}
