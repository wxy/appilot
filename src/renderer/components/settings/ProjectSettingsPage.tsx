import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useProject } from "../../stores/project";
import { EmptyState } from "../ui/EmptyState";
import { btnPrimary, btnSmSecondary, inputLineClass } from "../ui/styles";
import { CredentialsForm } from "./CredentialsForm";

export function ProjectSettingsPage() {
  const { projectId = "" } = useParams();
  const { projects, load } = useProject();
  const project = projects.find((item) => item.id === projectId) || null;
  const navigate = useNavigate();

  const [name, setName] = useState("");
  const [localPath, setLocalPath] = useState("");
  const [githubUrl, setGithubUrl] = useState("");
  const [savingInfo, setSavingInfo] = useState(false);
  const [infoMsg, setInfoMsg] = useState("");
  const [error, setError] = useState("");
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [creds, setCreds] = useState<any>(null);

  useEffect(() => {
    if (!projectId) return;
    (window as any).appilot?.projects
      ?.getCredentials(projectId)
      .then(setCreds)
      .catch(() => setCreds(null));
  }, [projectId]);

  const refreshCreds = async () => {
    if (!projectId) return;
    const next = await (window as any).appilot.projects.getCredentials(projectId);
    setCreds(next);
  };
  const hasOverride =
    creds?.githubSource === "project" || creds?.ascSource === "project";

  useEffect(() => {
    if (!project) return;
    setName(project.name);
    setLocalPath(project.localPath);
    setGithubUrl(project.repo?.githubUrl || "");
  }, [project?.id]);

  if (!project) {
    return <EmptyState title="项目不存在" desc="返回总览选择一个项目。" />;
  }

  const handleSaveInfo = async () => {
    setSavingInfo(true);
    setInfoMsg("");
    setError("");
    try {
      await (window as any).appilot.projects.updateSettings(project.id, {
        name: name.trim(),
        localPath: localPath.trim(),
        githubUrl: githubUrl.trim() || null,
      });
      await load();
      setInfoMsg("已保存");
    } catch (e: any) {
      setError(e.message || "保存失败");
    } finally {
      setSavingInfo(false);
    }
  };

  return (
    <div className="p-8 max-w-3xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={() => navigate("/overview")}
          className="text-zinc-400 dark:text-zinc-500 hover:text-zinc-600 dark:hover:text-zinc-300 text-lg"
          title="返回总览"
        >
          ←
        </button>
        <div>
          <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">项目设置</h2>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-0.5">
            {project.name} · 基本信息与 API 凭据
          </p>
        </div>
      </div>

      {error && (
        <div className="mb-4 p-3 rounded-xl bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800/50 text-sm text-red-700 dark:text-red-400">
          {error}
        </div>
      )}

      {/* 基本信息 */}
      <section className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm overflow-hidden mb-6">
        <div className="px-5 py-3 border-b border-zinc-100 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/50">
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">基本信息</h3>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="block text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1">
              项目名称
            </label>
            <input
              className={inputLineClass}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="项目显示名"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1">
              本地仓库路径
            </label>
            <div className="flex gap-2">
              <input
                className={inputLineClass}
                value={localPath}
                onChange={(e) => setLocalPath(e.target.value)}
                placeholder="/path/to/repo"
              />
              <button
                onClick={async () => {
                  const folder = await (window as any).appilot?.dialog?.selectFolder();
                  if (folder) setLocalPath(folder);
                }}
                className={btnSmSecondary + " shrink-0"}
                type="button"
              >
                选择…
              </button>
            </div>
            <p className="mt-1 text-[11px] text-zinc-400 dark:text-zinc-500">
              仓库移动/改名后在此重新指向；保存时会校验目录与 .git 并重扫仓库信息。
            </p>
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1">
              GitHub 仓库 URL
            </label>
            <input
              className={inputLineClass}
              value={githubUrl}
              onChange={(e) => setGithubUrl(e.target.value)}
              placeholder="https://github.com/owner/repo"
            />
            <p className="mt-1 text-[11px] text-zinc-400 dark:text-zinc-500">
              默认从 git remote 探测；留空保存则恢复自动探测。
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => void handleSaveInfo()} disabled={savingInfo} className={btnPrimary}>
              {savingInfo ? "保存中…" : "保存基本信息"}
            </button>
            {infoMsg && <span className="text-xs text-emerald-600 dark:text-emerald-400">{infoMsg}</span>}
          </div>
        </div>
      </section>

      {/* 凭据（本项目覆盖） */}
      <section className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm overflow-hidden mb-6">
        <div className="px-5 py-3 border-b border-zinc-100 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/50">
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            API 凭据（本项目覆盖）
          </h3>
        </div>
        {!overrideOpen ? (
          <div className="p-5">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm text-zinc-800 dark:text-zinc-200">
                  {hasOverride ? "已使用本项目凭据" : "默认使用全局凭据"}
                </div>
                <div className="text-[11px] text-zinc-400 dark:text-zinc-500 mt-1">
                  全局 GitHub Token {creds?.globalGithubTokenSet ? "✓ 已配置" : "✕ 未配置"}
                  {" · "}全局 App Store Key {creds?.globalAscKeySet ? "✓ 已配置" : "✕ 未配置"}
                  {hasOverride
                    ? "；本项目已覆盖，可点击右侧查看/修改。"
                    : "；未配置全局时相关能力不可用。"}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setOverrideOpen(true)}
                className={btnSmSecondary + " shrink-0"}
              >
                {hasOverride ? "查看/修改本项目凭据" : "使用其他凭证"}
              </button>
            </div>
          </div>
        ) : (
          <div className="p-5 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <p className="text-[11px] text-zinc-400 dark:text-zinc-500">
                全局凭据自动适用于本项目；这里仅编辑本项目自己的凭据，未配置时显示空表单，
                不会展示或改动全局值。清除本项目凭据后回退全局。
              </p>
              <button
                type="button"
                onClick={() => setOverrideOpen(false)}
                className={btnSmSecondary + " shrink-0"}
              >
                收起
              </button>
            </div>
            <CredentialsForm
              projectId={project.id}
              scope="project"
              onChanged={() => void refreshCreds()}
            />
          </div>
        )}
      </section>
    </div>
  );
}
