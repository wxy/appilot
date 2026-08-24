import { useNavigate } from "react-router-dom";
import { cn } from "../../lib/utils";
import { AppleIcon, GithubIcon } from "./Icons";

const CREDENTIAL_BADGE_DETAIL: Record<"github" | "asc", string> = {
  github: "私有/草案 release 公告、真实 PR 素材、仓库流量与资产下载量",
  asc: "版本/审核状态回读、审核意见（待实测）、评论洞察、销量/下载分析（待实测）",
};

/** Small chip marking a feature that is enhanced by a saved credential.
 *  Configured → solid; missing → dashed, clickable to jump to project settings. */
export function CredentialBadge({
  kind,
  enabled,
  projectId,
}: {
  kind: "github" | "asc";
  enabled: boolean;
  projectId: string;
}) {
  const navigate = useNavigate();
  const Icon = kind === "github" ? GithubIcon : AppleIcon;
  const label = kind === "github" ? "GitHub" : "ASC";
  const detail = CREDENTIAL_BADGE_DETAIL[kind];
  return (
    <button
      type="button"
      onClick={() => {
        if (!enabled) navigate(`/projects/${projectId}/settings`);
      }}
      title={
        enabled
          ? `已配置，用于：${detail}`
          : `未配置，可解锁：${detail}（点击前往项目设置）`
      }
      className={cn(
        "inline-flex items-center gap-1 px-2 h-6 rounded-full text-[11px] transition-colors",
        enabled
          ? "bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 ring-1 ring-zinc-200 dark:ring-zinc-700"
          : "border border-dashed border-zinc-300 dark:border-zinc-700 text-zinc-400 dark:text-zinc-500 hover:border-amber-500/60 hover:text-amber-600 dark:hover:text-amber-400",
      )}
    >
      <Icon className="w-3.5 h-3.5 text-current" />
      {label}
    </button>
  );
}
