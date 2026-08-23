import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useProject } from "../../stores/project";
import { btnPrimary } from "../ui/styles";

export function HomePage() {
  const { projects, select, addByFolder } = useProject();
  const navigate = useNavigate();
  const [adding, setAdding] = useState(false);

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
          <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-3">你的项目</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            {projects.map((p) => (
              <button
                key={p.id}
                onClick={() => openProject(p.id)}
                className="flex items-center gap-3 px-4 py-4 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-left shadow-sm hover:border-amber-500/50 transition-colors"
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
                <div className="min-w-0">
                  <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200 truncate">
                    {p.trackName || p.name}
                  </p>
                  <p className="text-xs text-zinc-400 dark:text-zinc-500 truncate mt-0.5">
                    {(p.storeProducts || []).map((product) =>
                      product.platform === "ios" ? "iOS" : product.platform === "macos" ? "macOS" : "未识别",
                    ).join(" · ") || "未识别"}
                  </p>
                </div>
              </button>
            ))}
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
