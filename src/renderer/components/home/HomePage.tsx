import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useProject } from "../../stores/project";
import { btnPrimary, btnSecondary } from "../ui/styles";
import { cn } from "../../lib/utils";

export function HomePage() {
  const { projects, select, addByFolder, remove } = useProject();
  const navigate = useNavigate();
  const [adding, setAdding] = useState(false);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [confirmText, setConfirmText] = useState("");

  const handleAdd = async () => {
    setAdding(true);
    try {
      const folder = await (window as any).appilot?.dialog?.selectFolder();
      if (folder) {
        await addByFolder(folder);
        navigate("/overview");
      }
    } finally {
      setAdding(false);
    }
  };

  const openProject = (id: string) => {
    select(id);
    navigate("/overview");
  };

  const displayName = (p: { name: string; trackName?: string | null }) =>
    p.trackName || p.name;

  return (
    <div className="p-10 max-w-3xl mx-auto">
      <h2 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100 mb-2">
        欢迎回来，副驾驶待命中
      </h2>
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        选择一个项目开始，或接入一个新的应用仓库。
      </p>

      {projects.length > 0 && (
        <div className="mt-10">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">你的项目</h3>
            <span className="text-[11px] text-zinc-400 dark:text-zinc-500">
              删除项目需输入项目名确认，不可撤销
            </span>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {projects.map((p) => {
              const display = displayName(p);
              const platformText =
                (p.storeProducts || [])
                  .map((product) =>
                    product.platform === "ios"
                      ? "iOS"
                      : product.platform === "macos"
                        ? "macOS"
                        : "未识别",
                  )
                  .join(" · ") || "未识别";

              if (confirmingId === p.id) {
                return (
                  <div
                    key={p.id}
                    className="rounded-2xl border border-red-200 dark:border-red-800/50 bg-red-50/40 dark:bg-red-950/10 shadow-sm px-4 py-4 space-y-3"
                  >
                    <p className="text-sm text-red-700 dark:text-red-400">
                      删除项目「{display}」？关键词、排名历史、素材将不再显示，此操作不可撤销。
                    </p>
                    <input
                      autoFocus
                      value={confirmText}
                      onChange={(e) => setConfirmText(e.target.value)}
                      placeholder={`输入 ${display} 以确认`}
                      className="w-full px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-900 text-sm text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-500"
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={() => {
                          setConfirmingId(null);
                          setConfirmText("");
                        }}
                        className={btnSecondary}
                      >
                        取消
                      </button>
                      <button
                        disabled={confirmText !== display}
                        onClick={async () => {
                          await remove(p.id);
                          setConfirmingId(null);
                          setConfirmText("");
                        }}
                        className="px-3 py-1.5 text-sm rounded-lg bg-red-600 hover:bg-red-700 text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                      >
                        确认删除
                      </button>
                    </div>
                  </div>
                );
              }

              return (
                <div
                  key={p.id}
                  className="group rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm hover:border-amber-500/50 transition-colors overflow-hidden"
                >
                  <button
                    onClick={() => openProject(p.id)}
                    className="w-full flex items-center gap-3 px-4 py-4 text-left"
                  >
                    {p.artworkUrl ? (
                      <img
                        src={p.artworkUrl}
                        alt=""
                        className="w-10 h-10 rounded-xl border border-zinc-200 dark:border-zinc-800 object-cover shrink-0"
                      />
                    ) : (
                      <div className="w-10 h-10 rounded-xl bg-amber-50 dark:bg-amber-500/10 flex items-center justify-center shrink-0">
                        <span className="text-amber-500">⌖</span>
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200 truncate">
                        {display}
                      </p>
                      <p className="text-xs text-zinc-400 dark:text-zinc-500 truncate mt-0.5">
                        {platformText}
                      </p>
                    </div>
                  </button>
                  <button
                    aria-label={`删除项目 ${display}`}
                    onClick={() => {
                      setConfirmingId(p.id);
                      setConfirmText("");
                    }}
                    className={cn(
                      "w-full flex items-center justify-center gap-1 px-2 py-1.5 text-[11px] text-zinc-400 dark:text-zinc-500",
                      "border-t border-zinc-100 dark:border-zinc-800",
                      "opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity",
                      "hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50/60 dark:hover:bg-red-950/20",
                    )}
                  >
                    <span className="text-xs">🗑</span> 删除项目
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="mt-10 rounded-2xl border border-dashed border-zinc-200 dark:border-zinc-800 p-10 text-center">
        <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-4">
          接入一个本地应用仓库，让副驾驶识别产品并建立基础档案。
        </p>
        <button onClick={handleAdd} disabled={adding} className={btnPrimary}>
          {adding ? "正在分析..." : "＋ 添加项目"}
        </button>
      </div>
    </div>
  );
}
