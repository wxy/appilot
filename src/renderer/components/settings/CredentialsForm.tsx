import { useEffect, useState } from "react";
import { cn } from "../../lib/utils";
import { GithubIcon, AppleIcon } from "../ui/Icons";
import { CredentialStatus } from "../ui/CredentialStatus";
import {
  btnSmPrimary,
  btnSmSecondary,
  credentialCodeChipClass,
  credentialHelpPanelClass,
  inputLineClass,
} from "../ui/styles";

const GITHUB_CAPABILITIES = ["私有/草案 release 公告", "真实 PR 素材", "远程仓库数据"];
const ASC_CAPABILITIES = ["版本/审核状态回读", "审核意见（待实测）", "评论洞察（免费 RSS）", "销量/下载分析（待实测）"];

export function CredentialsForm({
  projectId,
  scope,
  onChanged,
}: {
  projectId: string;
  scope: "global" | "project";
  onChanged?: () => void;
}) {
  const [githubToken, setGithubToken] = useState("");
  const [githubExpiresAt, setGithubExpiresAt] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [ascIssuerId, setAscIssuerId] = useState("");
  const [ascKeyId, setAscKeyId] = useState("");
  const [ascKeyPath, setAscKeyPath] = useState("");
  const [creds, setCreds] = useState<any>(null);
  const [testing, setTesting] = useState<"github" | "asc" | null>(null);
  const [feedback, setFeedback] = useState<{
    github?: { ok: boolean; msg: string };
    asc?: { ok: boolean; msg: string };
  }>({});
  const [saved, setSaved] = useState<{ github: boolean; asc: boolean }>({
    github: false,
    asc: false,
  });
  const [saveError, setSaveError] = useState<"github" | "asc" | null>(null);
  const [editing, setEditing] = useState<{ github: boolean; asc: boolean }>({
    github: false,
    asc: false,
  });
  const [confirmClear, setConfirmClear] = useState<{ github: boolean; asc: boolean }>({
    github: false,
    asc: false,
  });

  // Project scope edits only the project's own override credentials. It must
  // NOT show effective (global ?? override) values, otherwise the override
  // form looks like it is replacing the global credentials.
  const isProject = scope === "project";

  useEffect(() => {
    refreshCreds().catch(() => setCreds(null));
  }, [projectId]);

  // Re-enter mode always shows the saved values: fill empty fields whenever
  // credentials arrive/refresh, preserving anything the user typed.
  useEffect(() => {
    if (!editing.github || !creds) return;
    const masked = isProject ? creds.projectGithubTokenMasked : creds.githubTokenMasked;
    if (!masked) return;
    setGithubToken((current) => current || masked || "");
    setGithubExpiresAt(
      (current) =>
        current ||
        (isProject ? creds.projectGithubExpiresAt : creds.githubExpiresAt) ||
        "",
    );
  }, [editing.github, creds?.githubTokenMasked, creds?.projectGithubTokenMasked, isProject]);

  useEffect(() => {
    if (!editing.asc || !creds) return;
    setAscIssuerId(
      (current) => current || (isProject ? creds.projectAscIssuerId : creds.ascIssuerId) || "",
    );
    setAscKeyId(
      (current) => current || (isProject ? creds.projectAscKeyId : creds.ascKeyId) || "",
    );
    setAscKeyPath(
      (current) =>
        current || (isProject ? creds.projectAscPrivateKeyPath : creds.ascPrivateKeyPath) || "",
    );
  }, [editing.asc, creds, isProject]);

  const refreshCreds = async () => {
    const next = await (window as any).appilot.projects.getCredentials(projectId);
    setCreds(next);
  };

  const githubUnlocked = isProject
    ? Boolean(creds?.projectHasGithubToken)
    : Boolean(creds?.hasGithubToken);
  const ascUnlocked = isProject
    ? Boolean(creds?.projectHasAscKey)
    : Boolean(creds?.hasAscKey);
  const githubSource = isProject
    ? creds?.projectHasGithubToken
      ? "项目覆盖"
      : null
    : creds?.githubSource === "project"
      ? "项目覆盖"
      : creds?.githubSource === "global"
        ? "全局"
        : null;
  const ascSource = isProject
    ? creds?.projectHasAscKey
      ? "项目覆盖"
      : null
    : creds?.ascSource === "project"
      ? "项目覆盖"
      : creds?.ascSource === "global"
        ? "全局"
        : null;
  const savedAscKeyPath = isProject
    ? creds?.projectAscPrivateKeyPath
    : creds?.ascPrivateKeyPath;
  const githubExpiryWarning = (() => {
    const date =
      githubExpiresAt ||
      (isProject ? creds?.projectGithubExpiresAt : creds?.githubExpiresAt) ||
      "";
    if (!date) return null;
    const days = Math.ceil(
      (new Date(`${date}T00:00:00`).getTime() - Date.now()) / 86_400_000,
    );
    if (days < 0) return { expired: true, text: `Token 已于 ${date} 过期，请更换` };
    if (days <= 7) {
      return {
        expired: false,
        text: `Token 将于 ${date} 到期（剩 ${days} 天），请提前更换`,
      };
    }
    return null;
  })();

  const testAndSave = async (kind: "github" | "asc") => {
    setTesting(kind);
    setSaveError(null);
    try {
      const githubValue =
        kind === "github" &&
        githubToken ===
          (isProject ? creds?.projectGithubTokenMasked : creds?.githubTokenMasked)
          ? undefined
          : githubToken;
      const r =
        kind === "github"
          ? await (window as any).appilot.projects.testGithubToken(projectId, githubValue)
          : await (window as any).appilot.projects.testAscKey(projectId, {
              issuerId: ascIssuerId,
              keyId: ascKeyId,
              privateKeyPath: ascKeyPath,
            });
      if (!r.ok) {
        setFeedback((prev) => ({
          ...prev,
          [kind]: { ok: false, msg: r.error || "测试失败" },
        }));
        return;
      }
      setFeedback((prev) => ({
        ...prev,
        [kind]: { ok: true, msg: "测试通过" },
      }));
      await (window as any).appilot.projects.saveCredentials(projectId, {
        scope,
        githubToken: kind === "github" ? githubValue : undefined,
        githubExpiresAt: kind === "github" ? githubExpiresAt : undefined,
        ascIssuerId: kind === "asc" ? ascIssuerId : undefined,
        ascKeyId: kind === "asc" ? ascKeyId : undefined,
        ascPrivateKeyPath: kind === "asc" ? ascKeyPath : undefined,
      });
      setSaved((prev) => ({ ...prev, [kind]: true }));
      setEditing((prev) => ({ ...prev, [kind]: false }));
      setConfirmClear((prev) => ({ ...prev, [kind]: false }));
      if (kind === "github") {
        setGithubToken("");
        setGithubExpiresAt("");
      }
      else {
        setAscIssuerId("");
        setAscKeyId("");
        setAscKeyPath("");
      }
      await refreshCreds();
      onChanged?.();
    } catch (e: any) {
      setSaveError(kind);
      setFeedback((prev) => ({
        ...prev,
        [kind]: { ok: false, msg: e.message || "测试失败" },
      }));
    } finally {
      setTesting(null);
    }
  };

  const clearBlock = async (kind: "github" | "asc") => {
    if (!confirmClear[kind]) {
      setConfirmClear((prev) => ({ ...prev, [kind]: true }));
      return;
    }
    setConfirmClear((prev) => ({ ...prev, [kind]: false }));
    setSaveError(null);
    try {
      await (window as any).appilot.projects.saveCredentials(projectId, {
        scope,
        githubToken: kind === "github" ? "" : undefined,
        ascIssuerId: kind === "asc" ? "" : undefined,
        ascKeyId: kind === "asc" ? "" : undefined,
        ascPrivateKeyPath: kind === "asc" ? "" : undefined,
      });
      setSaved((prev) => ({ ...prev, [kind]: false }));
      setFeedback((prev) => ({ ...prev, [kind]: undefined }));
      setEditing((prev) => ({ ...prev, [kind]: false }));
      if (kind === "github") {
        setGithubToken("");
        setGithubExpiresAt("");
      }
      else {
        setAscIssuerId("");
        setAscKeyId("");
        setAscKeyPath("");
      }
      await refreshCreds();
      onChanged?.();
    } catch (e: any) {
      setSaveError(kind);
    }
  };

  const handleTestGithub = async () => {
    setTesting("github");
    setSaveError(null);
    try {
      const r = await (window as any).appilot.projects.testGithubToken(
        projectId,
        githubToken || undefined,
      );
      setFeedback((prev) => ({
        ...prev,
        github: r.ok
          ? { ok: true, msg: `测试通过${r.user ? `：${r.user}` : ""}` }
          : { ok: false, msg: r.error || "连接失败" },
      }));
    } catch (e: any) {
      setFeedback((prev) => ({
        ...prev,
        github: { ok: false, msg: e.message || "连接失败" },
      }));
    } finally {
      setTesting(null);
    }
  };

  const handleTestAsc = async () => {
    setTesting("asc");
    setSaveError(null);
    try {
      const r = await (window as any).appilot.projects.testAscKey(projectId, {
        issuerId: ascIssuerId || undefined,
        keyId: ascKeyId || undefined,
        privateKeyPath: ascKeyPath || undefined,
      });
      setFeedback((prev) => ({
        ...prev,
        asc: r.ok
          ? { ok: true, msg: "测试通过" }
          : { ok: false, msg: r.error || "连接失败" },
      }));
    } catch (e: any) {
      setFeedback((prev) => ({
        ...prev,
        asc: { ok: false, msg: e.message || "连接失败" },
      }));
    } finally {
      setTesting(null);
    }
  };

  const basename = (full: string) => full.split("/").pop() || full;

  return (
    <div className="space-y-5">
      {!githubUnlocked || editing.github ? (
      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-4 space-y-3">
        <div className="flex items-center gap-2">
          <GithubIcon />
          <span className="text-sm font-medium text-zinc-800 dark:text-zinc-200">GitHub Token</span>
          <CredentialStatus unlocked={githubUnlocked} source={githubSource} />
        </div>
        <div className="flex gap-2">
          <input
            className={inputLineClass + " font-mono"}
            type={showToken ? "text" : "password"}
            value={githubToken}
            onChange={(e) => {
              setGithubToken(e.target.value);
              setSaved((prev) => ({ ...prev, github: false }));
              setFeedback((prev) => ({ ...prev, github: undefined }));
              setConfirmClear((prev) => ({ ...prev, github: false }));
            }}
            placeholder={githubUnlocked ? "原 Token（修改则输入新值）" : "ghp_… 或 github_pat_…"}
          />
          <button
            type="button"
            onClick={() => setShowToken((value) => !value)}
            className={btnSmSecondary + " shrink-0"}
            title={showToken ? "隐藏" : "显示"}
          >
            {showToken ? "隐藏" : "显示"}
          </button>
        </div>
        <div>
          <label className="block text-[11px] text-zinc-400 mb-1">
            过期时间（可选）
          </label>
          <input
            className={inputLineClass + " max-w-44"}
            type="date"
            value={githubExpiresAt}
            onChange={(e) => {
              setGithubExpiresAt(e.target.value);
              setSaved((prev) => ({ ...prev, github: false }));
              setFeedback((prev) => ({ ...prev, github: undefined }));
              setConfirmClear((prev) => ({ ...prev, github: false }));
            }}
          />
          {githubExpiryWarning && (
            <p
              className={cn(
                "mt-1 text-[11px]",
                githubExpiryWarning.expired
                  ? "text-red-500 dark:text-red-400"
                  : "text-amber-600 dark:text-amber-400",
              )}
            >
              {githubExpiryWarning.text}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void testAndSave("github")}
            disabled={testing === "asc" || !githubToken.trim()}
            className={cn(
              btnSmPrimary,
              saveError === "github" && "!bg-red-500",
              saved.github && "!bg-emerald-500",
            )}
            title={
              !githubToken.trim()
                ? "请先输入 Token"
                : saveError === "github"
                  ? "保存失败，请重试"
                  : saved.github
                    ? "已保存"
                    : feedback.github?.msg
            }
          >
            {!githubToken.trim()
              ? "测试并保存"
              : testing === "github"
                ? "测试中…"
                : saveError === "github"
                  ? "✕ 保存失败"
                  : saved.github
                    ? "✓ 已保存"
                    : feedback.github && !feedback.github.ok
                      ? "✕ 测试失败"
                      : "测试并保存"}
          </button>
          <button
            type="button"
            onClick={() => void clearBlock("github")}
            className={cn(
              "px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors",
              confirmClear.github
                ? "bg-red-500 border-red-500 text-white hover:bg-red-600"
                : "border-red-300 dark:border-red-800 text-red-500 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/20",
            )}
          >
            {confirmClear.github ? "确认清除？" : "清除"}
          </button>
          {githubUnlocked && (
            <button
              type="button"
              onClick={() => {
                setEditing((prev) => ({ ...prev, github: false }));
                setConfirmClear((prev) => ({ ...prev, github: false }));
                setGithubToken("");
                setGithubExpiresAt("");
                setFeedback((prev) => ({ ...prev, github: undefined }));
              }}
              className="text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
            >
              放弃修改
            </button>
          )}
        </div>
        {feedback.github && !feedback.github.ok && (
          <p className="text-[11px] text-red-500 dark:text-red-400">{feedback.github.msg}</p>
        )}
        <div className={credentialHelpPanelClass}>
          <div className="flex items-start justify-between gap-3">
            <p className="text-[11px] leading-5 text-zinc-500 dark:text-zinc-400">
              GitHub → Settings → Developer settings → Personal access tokens，
              建议使用 fine-grained（细粒度）Token
            </p>
            <button
              type="button"
              onClick={() => (window as any).appilot?.openExternal("https://github.com/settings/personal-access-tokens")}
              className="shrink-0 whitespace-nowrap text-[11px] text-amber-600 dark:text-amber-400 hover:underline"
            >
              前往创建 ↗
            </button>
          </div>
          <div>
            <p className="text-[10px] font-medium text-zinc-400 dark:text-zinc-500">
              推荐权限
            </p>
            <ul className="mt-1 space-y-1">
              <li className="flex items-start gap-1.5">
                <code className={credentialCodeChipClass + " mt-px shrink-0"}>
                  Contents: Read
                </code>
                <span className="text-[11px] leading-5 text-zinc-500 dark:text-zinc-400">
                  release 与仓库内容（GitHub 没有独立的 Release 权限，release 归
                  Contents 管）
                </span>
              </li>
              <li className="flex items-start gap-1.5">
                <code className={credentialCodeChipClass + " mt-px shrink-0"}>
                  Pull requests: Read
                </code>
                <span className="text-[11px] leading-5 text-zinc-500 dark:text-zinc-400">
                  PR 信息（Metadata 自动包含）
                </span>
              </li>
            </ul>
          </div>
          <p className="text-[11px] leading-5 text-zinc-500 dark:text-zinc-400">
            读取已发布的 release 只需{" "}
            <code className={credentialCodeChipClass}>Contents: Read</code>
            ；草案 release 与一键发布需要{" "}
            <code className={credentialCodeChipClass}>Contents: Write</code>
            （对该仓库有写权限 push access）。
          </p>
          <p className="text-[11px] leading-5 text-zinc-400 dark:text-zinc-500">
            有效期：GitHub 不提供读取 Token 到期时间的接口；创建时可选择「不过期（No
            expiration）」，或在表单中填写过期时间，到期前 7 天会提醒更换。
          </p>
        </div>
      </div>
      ) : (
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-4 space-y-3">
          <div className="flex items-center gap-2">
            <GithubIcon />
            <span className="text-sm font-medium text-zinc-800 dark:text-zinc-200">GitHub Token</span>
            <CredentialStatus unlocked source={githubSource} />
          </div>
          <ul className="space-y-1">
            {GITHUB_CAPABILITIES.map((capability) => (
              <li
                key={capability}
                className="flex items-center gap-1.5 text-[11px] text-zinc-500 dark:text-zinc-400"
              >
                <span className="text-emerald-500">✓</span> {capability}
              </li>
            ))}
          </ul>
          <div className="border-t border-zinc-100 dark:border-zinc-800 pt-2 space-y-1">
            <p className="text-[10px] font-semibold tracking-wider text-zinc-400 dark:text-zinc-500">
              能力 · 所需权限
            </p>
            <div className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 text-[10px] text-zinc-500 dark:text-zinc-400">
              <span>发布草案 / 发布公告</span>
              <code className={credentialCodeChipClass}>Contents: Read</code>
              <span>仓库流量数据</span>
              <code className={credentialCodeChipClass}>Administration: Read</code>
              <span>评论（App Store RSS）</span>
              <span className="text-zinc-400">无需凭证</span>
            </div>
          </div>
          {githubExpiryWarning && (
            <p
              className={cn(
                "text-[11px]",
                githubExpiryWarning.expired
                  ? "text-red-500 dark:text-red-400"
                  : "text-amber-600 dark:text-amber-400",
              )}
            >
              {githubExpiryWarning.text}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void handleTestGithub()}
              disabled={testing === "asc"}
              className={cn(
                btnSmSecondary,
                feedback.github?.ok &&
                  "!text-emerald-600 dark:!text-emerald-400 !border-emerald-300 dark:!border-emerald-800",
                feedback.github &&
                  !feedback.github.ok &&
                  "!text-red-600 dark:!text-red-400 !border-red-300 dark:!border-red-800",
              )}
              title={feedback.github?.msg}
            >
              {testing === "github"
                ? "测试中…"
                : feedback.github
                  ? feedback.github.ok
                    ? "✓ 测试通过"
                    : "✕ 测试失败"
                  : "测试凭证"}
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing((prev) => ({ ...prev, github: true }));
                setGithubToken(
                  (isProject ? creds?.projectGithubTokenMasked : creds?.githubTokenMasked) || "",
                );
                setGithubExpiresAt(
                  (isProject ? creds?.projectGithubExpiresAt : creds?.githubExpiresAt) || "",
                );
                setConfirmClear((prev) => ({ ...prev, github: false }));
              }}
              className={btnSmSecondary}
            >
              重新输入凭证
            </button>
          </div>
          {feedback.github && !feedback.github.ok && (
            <p className="text-[11px] text-red-500 dark:text-red-400">
              已保存的凭证可能已失效，可点击「重新输入凭证」更新。
            </p>
          )}
        </div>
      )}

      {!ascUnlocked || editing.asc ? (
      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-4 space-y-3">
        <div className="flex items-center gap-2">
          <AppleIcon />
          <span className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
            App Store Connect API Key
          </span>
          <CredentialStatus unlocked={ascUnlocked} source={ascSource} />
        </div>
        <div>
          <label className="block text-[11px] text-zinc-400 mb-1">Issuer ID</label>
          <input
            className={inputLineClass + " font-mono"}
            value={ascIssuerId}
            onChange={(e) => {
              setAscIssuerId(e.target.value);
              setSaved((prev) => ({ ...prev, asc: false }));
              setFeedback((prev) => ({ ...prev, asc: undefined }));
              setConfirmClear((prev) => ({ ...prev, asc: false }));
            }}
            placeholder={ascUnlocked ? "原 Issuer ID（修改则输入新值）" : "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"}
          />
        </div>
        <div>
          <label className="block text-[11px] text-zinc-400 mb-1">Key ID</label>
          <input
            className={inputLineClass + " font-mono"}
            value={ascKeyId}
            onChange={(e) => {
              setAscKeyId(e.target.value);
              setSaved((prev) => ({ ...prev, asc: false }));
              setFeedback((prev) => ({ ...prev, asc: undefined }));
              setConfirmClear((prev) => ({ ...prev, asc: false }));
            }}
            placeholder={ascUnlocked ? "原 Key ID（修改则输入新值）" : "XXXXXXXXXX"}
          />
        </div>
        <div>
          <label className="block text-[11px] text-zinc-400 mb-1">私钥（.p8 文件）</label>
          <div className="flex gap-2">
            <input
              className={inputLineClass + " font-mono text-xs"}
              value={ascKeyPath ? basename(ascKeyPath) : ""}
              onChange={(e) => setAscKeyPath(e.target.value)}
              placeholder="仅通过文件选择"
              readOnly
            />
            <button
              type="button"
              onClick={async () => {
                const file = await (window as any).appilot?.projects?.selectAscKeyFile();
                if (file) {
                  setAscKeyPath(file);
                  setSaved((prev) => ({ ...prev, asc: false }));
                  setFeedback((prev) => ({ ...prev, asc: undefined }));
                  setConfirmClear((prev) => ({ ...prev, asc: false }));
                }
              }}
              className={btnSmSecondary + " shrink-0"}
            >
              选择文件…
            </button>
          </div>
          <p className="mt-1 text-[11px] text-zinc-400 dark:text-zinc-500">
            {(ascKeyPath || savedAscKeyPath) && (
              <button
                type="button"
                onClick={() =>
                  (window as any).appilot?.revealInFolder?.(
                    ascKeyPath || savedAscKeyPath,
                  )
                }
                className="text-amber-600 dark:text-amber-400 hover:underline"
              >
                在访达中显示
              </button>
            )}
            {!ascKeyPath && !savedAscKeyPath && "仅支持文件选择，不提供粘贴"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void testAndSave("asc")}
            disabled={
              testing === "github" ||
              !ascIssuerId.trim() ||
              !ascKeyId.trim() ||
              !ascKeyPath
            }
            className={cn(
              btnSmPrimary,
              saveError === "asc" && "!bg-red-500",
              saved.asc && "!bg-emerald-500",
            )}
            title={
              !ascIssuerId.trim() || !ascKeyId.trim() || !ascKeyPath
                ? "请填写 Issuer / Key ID / .p8 文件"
                : saveError === "asc"
                  ? "保存失败，请重试"
                  : saved.asc
                    ? "已保存"
                    : feedback.asc?.msg
            }
          >
            {!ascIssuerId.trim() || !ascKeyId.trim() || !ascKeyPath
              ? "测试并保存"
              : testing === "asc"
                ? "测试中…"
                : saveError === "asc"
                  ? "✕ 保存失败"
                  : saved.asc
                    ? "✓ 已保存"
                    : feedback.asc && !feedback.asc.ok
                      ? "✕ 测试失败"
                      : "测试并保存"}
          </button>
          <button
            type="button"
            onClick={() => void clearBlock("asc")}
            className={cn(
              "px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors",
              confirmClear.asc
                ? "bg-red-500 border-red-500 text-white hover:bg-red-600"
                : "border-red-300 dark:border-red-800 text-red-500 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/20",
            )}
          >
            {confirmClear.asc ? "确认清除？" : "清除"}
          </button>
          {ascUnlocked && (
            <button
              type="button"
              onClick={() => {
                setEditing((prev) => ({ ...prev, asc: false }));
                setConfirmClear((prev) => ({ ...prev, asc: false }));
                setAscIssuerId("");
                setAscKeyId("");
                setAscKeyPath("");
                setFeedback((prev) => ({ ...prev, asc: undefined }));
              }}
              className="text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
            >
              放弃修改
            </button>
          )}
        </div>
        {feedback.asc && !feedback.asc.ok && (
          <p className="text-[11px] text-red-500 dark:text-red-400">{feedback.asc.msg}</p>
        )}
        <div className={credentialHelpPanelClass}>
          <div className="flex items-start justify-between gap-3">
            <p className="text-[11px] leading-5 text-zinc-500 dark:text-zinc-400">
              App Store Connect → 用户和访问 → 集成 → App Store Connect API
            </p>
            <button
              type="button"
              onClick={() => (window as any).appilot?.openExternal("https://appstoreconnect.apple.com/access/integrations/api")}
              className="shrink-0 whitespace-nowrap text-[11px] text-amber-600 dark:text-amber-400 hover:underline"
            >
              前往创建密钥 ↗
            </button>
          </div>
          <div>
            <p className="text-[10px] font-medium text-zinc-400 dark:text-zinc-500">
              字段来源
            </p>
            <ul className="mt-1 space-y-1">
              <li className="flex items-start gap-1.5">
                <code className={credentialCodeChipClass + " mt-px shrink-0"}>
                  Issuer ID
                </code>
                <span className="text-[11px] leading-5 text-zinc-500 dark:text-zinc-400">
                  该页顶部
                </span>
              </li>
              <li className="flex items-start gap-1.5">
                <code className={credentialCodeChipClass + " mt-px shrink-0"}>
                  Key ID
                </code>
                <code className={credentialCodeChipClass + " mt-px shrink-0"}>
                  .p8 文件
                </code>
                <span className="text-[11px] leading-5 text-zinc-500 dark:text-zinc-400">
                  创建密钥时下载
                </span>
              </li>
            </ul>
          </div>
          <p className="text-[11px] leading-5 text-zinc-500 dark:text-zinc-400">
            一把 Key 适用于同一账户（Team）下的所有应用；不同账户的应用需单独一把
            Key（可在项目设置中覆盖）。
          </p>
          <div className="flex items-start gap-1.5 rounded-md border border-amber-200/70 dark:border-amber-500/20 bg-amber-50 dark:bg-amber-500/10 px-2.5 py-2">
            <span
              aria-hidden="true"
              className="mt-px text-[11px] leading-5 text-amber-500"
            >
              ⚠
            </span>
            <p className="text-[11px] leading-5 text-amber-700 dark:text-amber-300">
              创建密钥时权限请选择 App Manager（App 管理），否则无法读取/更新应用元数据。
            </p>
          </div>
          <p className="text-[11px] leading-5 text-zinc-400 dark:text-zinc-500">
            保存时会把 .p8 复制到应用数据目录（副本随凭据保存，原文件移动/删除不影响）；
            Apple 不支持重新下载密钥，请妥善保管或必要时新建。
          </p>
        </div>
      </div>
      ) : (
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-4 space-y-3">
          <div className="flex items-center gap-2">
            <AppleIcon />
            <span className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
              App Store Connect API Key
            </span>
            <CredentialStatus unlocked source={ascSource} />
          </div>
          <ul className="space-y-1">
            {ASC_CAPABILITIES.map((capability) => (
              <li
                key={capability}
                className="flex items-center gap-1.5 text-[11px] text-zinc-500 dark:text-zinc-400"
              >
                <span className="text-emerald-500">✓</span> {capability}
              </li>
            ))}
          </ul>
          <div className="border-t border-zinc-100 dark:border-zinc-800 pt-2 space-y-1">
            <p className="text-[10px] font-semibold tracking-wider text-zinc-400 dark:text-zinc-500">
              能力 · 所需权限
            </p>
            <div className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 text-[10px] text-zinc-500 dark:text-zinc-400">
              <span>版本 / 审核状态回读</span>
              <code className={credentialCodeChipClass}>ASC API Key</code>
              <span>评论（App Store RSS）</span>
              <span className="text-zinc-400">无需凭证</span>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void handleTestAsc()}
              disabled={testing === "github"}
              className={cn(
                btnSmSecondary,
                feedback.asc?.ok &&
                  "!text-emerald-600 dark:!text-emerald-400 !border-emerald-300 dark:!border-emerald-800",
                feedback.asc &&
                  !feedback.asc.ok &&
                  "!text-red-600 dark:!text-red-400 !border-red-300 dark:!border-red-800",
              )}
              title={feedback.asc?.msg}
            >
              {testing === "asc"
                ? "测试中…"
                : feedback.asc
                  ? feedback.asc.ok
                    ? "✓ 测试通过"
                    : "✕ 测试失败"
                  : "测试凭证"}
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing((prev) => ({ ...prev, asc: true }));
                setAscIssuerId(
                  (isProject ? creds?.projectAscIssuerId : creds?.ascIssuerId) || "",
                );
                setAscKeyId(
                  (isProject ? creds?.projectAscKeyId : creds?.ascKeyId) || "",
                );
                setAscKeyPath(
                  (isProject ? creds?.projectAscPrivateKeyPath : creds?.ascPrivateKeyPath) || "",
                );
                setConfirmClear((prev) => ({ ...prev, asc: false }));
              }}
              className={btnSmSecondary}
            >
              重新输入凭证
            </button>
          </div>
          {feedback.asc && !feedback.asc.ok && (
            <p className="text-[11px] text-red-500 dark:text-red-400">
              已保存的凭证可能已失效，可点击「重新输入凭证」更新。
            </p>
          )}
        </div>
      )}
    </div>
  );
}
