import { ipcMain } from "electron";
import { log } from "@appilot-labs/appilot-core/logger";
import { resolveEffectiveCredentials } from "../credentials";
import { githubSyncCacheEntry } from "../scheduler";
import { getStore } from "../store";
import { assertNonEmptyString } from "../util";

/**
 * 总览页取数 handler（新增能力①：GitHub repo 指标）。
 *
 * overview:repoMetrics(projectId, opts?) → GitHub 仓库的 Issue 计数 + PR 计数：
 * - pullsSince：自 `opts.since`（最近一次发布的 tag + ISO 时间）以来新建的 PR 数；
 *   未传 since 时取小时级 githubSyncCache 里最近一条真实已发布 release，仍无则退化为
 *   「当前 open PR 数」（见 core countPullsSince）。
 * - issues：open/closed 计数（search total_count，is:issue 排除 PR）。
 *
 * 边界/策略：
 * - 无 GitHub 远程 / 无有效 token → { ok:false, error }（不 throw，不阻塞总览其它部分）；
 * - 网络/API 失败在 core 侧降级为 null，整组结果仍 ok:true（部分指标不可用）；
 * - 结果按 (projectId + since 边界) 缓存到 kv（键 repoMetricsCache，TTL 1h），
 *   避免每次打开/刷新总览都打 GitHub；
 * - 纯 GitHub REST/Search，与 iTunes Search 熔断完全无关，不触发/不读取熔断状态。
 */

const REPO_METRICS_TTL_MS = 60 * 60_000;

export interface OverviewRepoMetricsSince {
  /** PR 统计边界（最近一次发布的 ISO 时间）。 */
  iso: string | null;
  /** 边界对应的发布 tag（展示用）。 */
  tag: string | null;
}

export interface OverviewRepoMetricsResult {
  ok: boolean;
  /** 自边界以来新建的 PR 数；null = 该子指标失败/降级。 */
  pullsSince: number | null;
  issues: { open: number; closed: number } | null;
  sinceTag: string | null;
  sinceIso: string | null;
  error?: string;
}

/** 从项目可用的 URL 形态解析 owner/repo（接受 https / git@ / .git 后缀）。 */
function ownerRepoFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const match = /(?:github\.com[/:])([^/]+)\/([^/]+?)(?:\.git)?\/?$/.exec(url.trim());
  if (!match) return null;
  const [, owner, repo] = match;
  if (!owner || !repo) return null;
  return `${owner}/${repo}`;
}

export function registerOverviewHandlers(): void {
  ipcMain.handle(
    "overview:repoMetrics",
    async (
      _event,
      projectId: string,
      opts?: { sinceIso?: string | null; sinceTag?: string | null },
    ): Promise<OverviewRepoMetricsResult> => {
      projectId = assertNonEmptyString(projectId, "projectId");
      const s = await getStore();
      const projects: any[] = s.get("projects") || [];
      const project = projects.find((item: any) => item.id === projectId);
      if (!project) return { ok: false, pullsSince: null, issues: null, sinceTag: null, sinceIso: null, error: "项目不存在" };

      // GitHub URL 优先取 repo.githubUrl（DB 轻量视图/富视图均有），兜底 githubUrl。
      const ownerRepo = ownerRepoFromUrl(project?.repo?.githubUrl ?? project?.githubUrl ?? null);
      if (!ownerRepo) {
        return { ok: false, pullsSince: null, issues: null, sinceTag: null, sinceIso: null, error: "未检测到 GitHub 远程仓库" };
      }
      const token = resolveEffectiveCredentials(s, projectId).githubToken;
      if (!token) {
        return { ok: false, pullsSince: null, issues: null, sinceTag: null, sinceIso: null, error: "缺少 GitHub 凭证，请到项目设置配置" };
      }

      // 统计边界：调用方（总览页按发布历史）优先；缺省回退小时级 GitHub 同步缓存里
      // 最近一条真实已发布 release（draft=false 且有 publishedAt）。
      let sinceIso: string | null = opts?.sinceIso || null;
      let sinceTag: string | null = opts?.sinceTag || null;
      if (!sinceIso) {
        const cached = githubSyncCacheEntry(s, project);
        const published = (cached?.releases || [])
          .filter((r: any) => !r?.draft && r?.publishedAt)
          .sort((a: any, b: any) =>
            String(b.publishedAt).localeCompare(String(a.publishedAt)),
          )[0];
        if (published) {
          sinceIso = published.publishedAt;
          sinceTag = published.tag ?? null;
        }
      }

      // kv 缓存（TTL 1h，按项目 + since 边界命中）。
      const cacheAll: Record<
        string,
        { at: number; sinceIso: string | null; sinceTag: string | null; result: OverviewRepoMetricsResult }
      > = s.get("repoMetricsCache") || {};
      const entry = cacheAll[projectId];
      if (
        entry &&
        Date.now() - entry.at < REPO_METRICS_TTL_MS &&
        entry.sinceIso === sinceIso &&
        entry.sinceTag === sinceTag
      ) {
        return entry.result;
      }

      try {
        const { fetchRepoIssueCounts, countPullsSince } = await import(
          "@appilot-labs/appilot-core/github-api"
        );
        const [issues, pullsSince] = await Promise.all([
          fetchRepoIssueCounts(ownerRepo, token),
          countPullsSince(ownerRepo, token, sinceIso),
        ]);
        const result: OverviewRepoMetricsResult = {
          ok: true,
          pullsSince,
          issues,
          sinceTag,
          sinceIso,
        };
        cacheAll[projectId] = { at: Date.now(), sinceIso, sinceTag, result };
        s.set("repoMetricsCache", cacheAll);
        log.debug(
          `overview:repoMetrics ${project.name} → pulls=${pullsSince} issues=${issues ? `${issues.open}/${issues.closed}` : "—"}`,
        );
        return result;
      } catch (err: any) {
        log.warn(`overview:repoMetrics failed for ${project.name}: ${err.message}`);
        return { ok: false, pullsSince: null, issues: null, sinceTag: sinceTag, sinceIso: sinceIso, error: err?.message || "获取仓库指标失败" };
      }
    },
  );
}
