import { useEffect, useState } from "react";
import { cn } from "../../lib/utils";
import { formatBytes } from "../../lib/format";

/**
 * 数据与存储（架构收敛 C3）：共享 SQLite 库的运维管理。
 * - 信息：路径 / 文件大小 / 各表行数 / 快照时间跨度
 * - 动作：清理旧快照（保留 N 天）/ 压缩 / 备份（VACUUM INTO）
 */
export function DataStorageCard() {
  const [info, setInfo] = useState<any>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [keepDays, setKeepDays] = useState(30);

  const load = () => {
    (window as any).appilot?.storage?.info()
      .then(setInfo)
      .catch(() => undefined);
  };
  useEffect(() => {
    load();
    return () => undefined;
  }, []);

  const run = async (action: string, fn: () => Promise<any>) => {
    if (busy) return;
    setBusy(action);
    setMsg(null);
    try {
      const res = await fn();
      if (res?.info) setInfo(res.info);
      if (res && res.canceled) {
        setMsg({ kind: "ok", text: "已取消" });
      } else if (res?.error) {
        setMsg({ kind: "err", text: res.error });
      } else {
        setMsg({
          kind: "ok",
          text:
            action === "prune"
              ? `已清理 ${res?.removed ?? 0} 条早于 ${res?.keepDays ?? keepDays} 天的快照`
              : action === "vacuum"
                ? `已压缩，回收 ${formatBytes(res?.reclaimedBytes ?? 0)}`
                : `备份已保存：${res?.path ?? ""}`,
        });
      }
    } catch (e: any) {
      setMsg({ kind: "err", text: e?.message || String(e) });
    } finally {
      setBusy(null);
      load();
    }
  };

  const prune = () => {
    if (!window.confirm(`确定清理早于最近 ${keepDays} 天的排名快照？该操作不可撤销。`)) return;
    void run("prune", () => (window as any).appilot?.storage?.pruneSnapshots(keepDays));
  };

  const c = info?.counts ?? {};
  const span = info?.snapshotSpan ?? {};
  const rowCls = "flex justify-between gap-4 py-1 text-[13px]";
  const labelCls = "text-zinc-500 dark:text-zinc-400";
  const valCls = "text-zinc-800 dark:text-zinc-100 font-medium text-right";
  const btnBase =
    "px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors disabled:opacity-50";

  return (
    <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden shadow-sm mb-8">
      <div className="px-6 py-4 border-b border-zinc-100 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/50">
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">数据与存储</h3>
      </div>
      <div className="p-6">
        <p className="text-[11px] text-zinc-400 dark:text-zinc-500 mb-4">
          共享 SQLite 数据库（任务实例 / 排名快照 / 发布缓存），常驻调度与各壳共用一份；
          快照随时间累积，可按需清理与备份。
        </p>

        {!info ? (
          <p className="text-[13px] text-zinc-400 dark:text-zinc-500">正在读取数据库信息…</p>
        ) : (
          <div className="mb-5">
            <div className="rounded-xl bg-zinc-50 dark:bg-zinc-800/50 px-4 py-2 text-[12px] text-zinc-500 dark:text-zinc-400 break-all" title={info.dbPath}>
              {info.dbPath}
            </div>
            <div className="mt-3 grid grid-cols-2 gap-x-8">
              <div className={rowCls}>
                <span className={labelCls}>文件大小</span>
                <span className={valCls}>
                  {formatBytes(info.sizeBytes || 0)}
                  {info.walSizeBytes > 0 ? ` + WAL ${formatBytes(info.walSizeBytes)}` : ""}
                </span>
              </div>
              <div className={rowCls}>
                <span className={labelCls}>任务实例</span>
                <span className={valCls}>{c.tasks ?? 0}</span>
              </div>
              <div className={rowCls}>
                <span className={labelCls}>排名快照</span>
                <span className={valCls}>{c.rankSnapshots ?? 0}</span>
              </div>
              <div className={rowCls}>
                <span className={labelCls}>产品记录</span>
                <span className={valCls}>{c.productRecords ?? 0}</span>
              </div>
              <div className={rowCls}>
                <span className={labelCls}>项目 / 发布缓存</span>
                <span className={valCls}>
                  {c.projects ?? 0} / {c.releaseCache ?? 0}
                </span>
              </div>
              <div className={rowCls}>
                <span className={labelCls}>快照时间跨度</span>
                <span className={valCls}>
                  {span.min ? new Date(span.min).toLocaleDateString() : "—"} ~{" "}
                  {span.max ? new Date(span.max).toLocaleDateString() : "—"}
                </span>
              </div>
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <select
            value={String(keepDays)}
            onChange={(e) => setKeepDays(Number(e.target.value))}
            className="px-2 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-transparent text-xs text-zinc-700 dark:text-zinc-300"
            title="保留最近 N 天，清理更早的排名快照"
          >
            {[7, 14, 30, 90, 365].map((d) => (
              <option key={d} value={String(d)}>
                保留 {d} 天
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={busy != null}
            onClick={prune}
            className={cn(
              btnBase,
              "border-red-500/60 text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-500/10 hover:border-red-600",
            )}
            title="清理早于保留期的旧排名快照（不可撤销）"
          >
            {busy === "prune" ? "清理中…" : "清理旧快照"}
          </button>
          <button
            type="button"
            disabled={busy != null}
            onClick={() => void run("vacuum", () => (window as any).appilot?.storage?.vacuum())}
            className={cn(btnBase, "border-zinc-300 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:border-zinc-400")}
            title="WAL checkpoint + VACUUM 收缩数据库文件"
          >
            {busy === "vacuum" ? "压缩中…" : "压缩数据库"}
          </button>
          <button
            type="button"
            disabled={busy != null}
            onClick={() => void run("backup", () => (window as any).appilot?.storage?.backup())}
            className={cn(
              btnBase,
              "border-emerald-500 text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10 hover:border-emerald-600",
            )}
            title="导出数据库一致性副本（VACUUM INTO）"
          >
            {busy === "backup" ? "备份中…" : "备份数据库…"}
          </button>
          {msg && (
            <span
              className={cn(
                "text-xs",
                msg.kind === "ok"
                  ? "text-emerald-600 dark:text-emerald-400"
                  : "text-red-500 dark:text-red-400",
              )}
            >
              {msg.text}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
