import { useNavigate } from "react-router-dom";
import { cn } from "../../lib/utils";
import { AppleIcon, GithubIcon } from "./Icons";

/** 无 Router 上下文（DSH 客户端）时安全回退：useNavigate 会 throw，捕获后置空。 */
function useSafeNavigate(): ((to: string) => void) | null {
  try {
    return useNavigate();
  } catch {
    return null;
  }
}

/** 底部状态栏的凭据状态标志：一眼看出 GitHub / App Store 凭据是否已设置。
 *  项目级覆盖 → 绿色实底；全局 → 中性实底；未设置 → 虚线灰。
 *  点击前往对应管理页（全局 → 全局设置；项目覆盖 / 未设置且有项目 → 项目设置）。
 *  各功能页不再重复展示“凭据已设置”类标志；代表数据来源的图标不受影响。 */
export function CredentialIndicator({
  kind,
  source,
  projectId,
}: {
  kind: "github" | "asc";
  source: "global" | "project" | null;
  projectId: string | null;
}) {
  const navigate = useSafeNavigate();
  const Icon = kind === "github" ? GithubIcon : AppleIcon;
  const label = kind === "github" ? "GitHub Token" : "App Store Key";
  const to = source === "global" || !projectId ? "/settings" : `/projects/${projectId}/settings`;
  const title =
    source === "project"
      ? `${label}：已设置（本项目覆盖全局），点击前往项目设置`
      : source === "global"
        ? `${label}：已设置（全局），点击前往全局设置`
        : `${label}：未设置，点击前往${projectId ? "项目设置" : "全局设置"}`;
  return (
    <button
      type="button"
      onClick={() => navigate?.(to)}
      title={title}
      className={cn(
        "inline-flex items-center gap-1.5 px-2.5 h-7 rounded-full text-[11px] transition-colors",
        source === "project"
          ? "bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 font-medium"
          : source === "global"
            ? "bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300"
            : "border border-dashed border-zinc-300 dark:border-zinc-700 text-zinc-400 dark:text-zinc-500 hover:border-amber-500/60 hover:text-amber-600 dark:hover:text-amber-400",
      )}
    >
      <Icon className="w-3.5 h-3.5 text-current" />
      <span className="hidden lg:inline">{kind === "github" ? "GitHub" : "App Store"}</span>
    </button>
  );
}
