/**
 * Appilot 工作台「发布」「趋势」tab：从 appilot_overview 节点渲染真实数据。
 */
import { jsx, jsxs } from 'react/jsx-runtime';
import type { CSSProperties } from 'react';
import { resultOf, chip, statusTone, kv } from './helpers';

function overviewValue(node: any): any {
  if (!node) return null;
  return resultOf(node.content).value;
}

/** 发布 tab：latestTag / GitHub 发布列表 / readiness 清单。 */
export function ReleaseTab(props: { node: any }) {
  const v = overviewValue(props.node);
  if (!v) return (
    <div className="ap-empty">
      <div className="ap-empty-title">发布工作台</div>
      <div className="ap-empty-hint">先切到「总览」点「刷新数据」，agent 会运行 appilot_overview 收集发布与 readiness 数据。</div>
    </div>
  );

  const rel = v.release || {};
  const readiness = rel.readiness || {};
  const checks = readiness.checks || [];
  const pass = checks.filter((c: any) => statusTone(c.status) === 'pass').length;
  const warn = checks.filter((c: any) => statusTone(c.status) === 'warn').length;
  const fail = checks.filter((c: any) => statusTone(c.status) === 'fail').length;
  const releases = rel.githubReleases || [];
  const drafts = releases.filter((r: any) => r && r.draft).length;

  return (
    <div className="ap-ov">
      <div className="ap-ov-card">
        <div className="ap-ov-card-title">当前发布{rel.latestTag ? ' · ' + rel.latestTag.name : ''}</div>
        <div className="ap-ov-row">
          {rel.latestTag ? chip('最新 tag ' + rel.latestTag.name, '') : chip('暂无 git tag', '')}
          {chip('GitHub 发布 ' + releases.length, '')}
          {drafts > 0 ? chip('草稿 ' + drafts, 'warn') : null}
        </div>
        {rel.recentTags && rel.recentTags.length ? (
          <div className="ap-wb-sub">
            最近 tag：{rel.recentTags.map((t: any) => t.name).join(' · ')}
          </div>
        ) : null}
      </div>

      <div className="ap-ov-card">
        <div className="ap-ov-card-title">GitHub 发布列表</div>
        {releases.length === 0 ? (
          <div className="ap-wb-sub">暂无 GitHub release（或需要 token 查看草稿/私有仓库）</div>
        ) : (
          releases.map((r: any, index: number) => (
            <div key={r.tag || index} className="ap-ov-row">
              {chip(r.tag || r.name || '发布', '')}
              {r.draft ? chip('草稿', 'warn') : null}
              {r.prerelease ? chip('预发布', '') : null}
              {r.publishedAt ? chip(new Date(r.publishedAt).toLocaleDateString(), '') : null}
            </div>
          ))
        )}
      </div>

      <div className="ap-ov-card">
        <div className="ap-ov-card-title">
          发布准备度{readiness.versionTag ? ' · ' + readiness.versionTag : ''}
        </div>
        <div className="ap-ov-row">
          {chip('通过 ' + pass, 'pass')}
          {warn > 0 ? chip('警告 ' + warn, 'warn') : null}
          {fail > 0 ? chip('失败 ' + fail, 'fail') : null}
        </div>
        {checks.length > 0 ? (
          <div className="ap-ov-row">
            {checks.map((c: any, index: number) =>
              chip((c.label || c.id || '检查项') + ' · ' + (c.status || ''), statusTone(c.status)),
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** 趋势 tab：近 30 天提交柱状条（CSS 实现，零依赖）+ 汇总。 */
export function TrendTab(props: { node: any }) {
  const v = overviewValue(props.node);
  const commits: Record<string, number> = (v && v.activity && v.activity.commits) || {};
  const traffic = v && v.activity && v.activity.traffic ? v.activity.traffic : null;
  const days = 30;
  const now = new Date();
  const bars: { date: string; count: number }[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    bars.push({ date: key, count: commits[key] || 0 });
  }
  const max = Math.max(1, ...bars.map((b) => b.count));
  const total = bars.reduce((sum, b) => sum + b.count, 0);
  const lastActive = [...bars].reverse().find((b) => b.count > 0);

  if (!v) return (
    <div className="ap-empty">
      <div className="ap-empty-title">长期效果</div>
      <div className="ap-empty-hint">先切到「总览」点「刷新数据」，这里会展示提交活跃趋势（后续接入排名/评论趋势）。</div>
    </div>
  );

  return (
    <div className="ap-ov">
      <div className="ap-ov-card">
        <div className="ap-ov-card-title">提交活跃（近 {days} 天）</div>
        <div className="ap-ov-row">
          {chip('共 ' + total + ' 次提交', '')}
          {lastActive ? chip('最近 ' + lastActive.date + ' · ' + lastActive.count + ' 次', '') : null}
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 64, paddingTop: 8 }}>
          {bars.map((b) => (
            <div
              key={b.date}
              title={`${b.date} · ${b.count} 次提交`}
              style={{
                flex: 1,
                height: b.count === 0 ? 2 : Math.max(3, Math.round((b.count / max) * 56)),
                background:
                  b.count === 0
                    ? 'var(--dsw-alias-border-l2)'
                    : 'var(--dsw-alias-state-success-primary)',
                opacity: b.count === 0 ? 0.5 : 0.75 + 0.25 * (b.count / max),
                borderRadius: 2,
              }}
            />
          ))}
        </div>
        <div className="ap-wb-sub">
          {bars[0].date} → {bars[bars.length - 1].date}（日粒度）
        </div>
      </div>
      {traffic ? (
        <div className="ap-ov-card">
          <div className="ap-ov-card-title">GitHub 流量（最近 14 天）</div>
          <div className="ap-ov-row">
            {chip('浏览 ' + (traffic.views ?? 0) + '（独立 ' + (traffic.uniqueViews ?? 0) + '）', '')}
            {chip('克隆 ' + (traffic.clones ?? 0) + '（独立 ' + (traffic.uniqueClones ?? 0) + '）', '')}
          </div>
          {traffic.referrers && traffic.referrers.length > 0 ? (
            <div className="ap-ov-row">
              {traffic.referrers.slice(0, 5).map((r: any, index: number) =>
                chip(r.url + ' · ' + (r.views ?? 0), ''),
              )}
            </div>
          ) : null}
        </div>
      ) : (
        <div className="ap-ov-card">
          <div className="ap-ov-card-title">GitHub 流量</div>
          <div className="ap-wb-sub">配置 GITHUB_TOKEN 后可查看（与独立应用趋势页同口径）</div>
        </div>
      )}
      {v.skipped && Object.keys(v.skipped).length > 0 ? (
        <div className="ap-ov-card">
          <div className="ap-ov-card-title">暂缓/未配置</div>
          <div className="ap-ov-row">
            {Object.entries(v.skipped)
              .filter(([, note]) => note)
              .map(([key, note]) => kv(key, note))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** 任务中心 tab：从 appilot_tasks 节点渲染定时任务状态。 */
export function TaskTab(props: {
  node: any;
  onRefresh?: () => void;
  onRunTask?: (taskId: string) => void;
  busy?: boolean;
}) {
  const v = overviewValue(props.node);
  if (!v) {
    return (
      <div className="ap-ov">
        <div className="ap-empty">
          <div className="ap-empty-title">任务中心</div>
          <div className="ap-empty-hint">
            点击「刷新任务状态」，agent 会运行 appilot_tasks 读取定时任务（发布同步 / readiness 检查）的状态。
          </div>
          <div style={{ marginTop: 8 }}>
            <button
              type="button"
              className="ap-btn"
              disabled={props.busy || undefined}
              onClick={props.onRefresh}
            >
              {props.busy ? '刷新中…' : '刷新任务状态'}
            </button>
          </div>
        </div>
      </div>
    );
  }
  const tasks = v.tasks || [];
  const electronTasks = tasks.filter((t: any) => t.source === 'electron');
  // DSH 可运行任务：v4 实例视图（每项目 github-sync 实例行）；旧节点无
  // dshInstances 时回退到静态定义/本来源行（兼容缓存旧结果）。
  const dshInstances: any[] = v.dshInstances || [];
  const runnableDefs: any[] =
    dshInstances.length > 0
      ? dshInstances
      : (v.definitions && v.definitions.length > 0)
        ? v.definitions
        : tasks.filter((t: any) => !t.source || t.source === 'dsh');
  return (
    <div className="ap-ov">
      <div className="ap-ov-row">
        <button
          type="button"
          className="ap-btn"
          disabled={props.busy || undefined}
          onClick={props.onRefresh}
        >
          {props.busy ? '刷新中…' : '刷新任务状态'}
        </button>
        <span className="ap-wb-sub">
          本侧任务由 dsh 服务端调度（核心执行器，runNow 可强制运行）；Electron 任务
          由其自身调度（共享只读）。列表来自 appilot_tasks。
        </span>
      </div>
      <div className="ap-wb-sub" style={{ margin: '4px 0 8px' }}>
        本侧任务实例（可运行）
      </div>
      {runnableDefs.length === 0 ? (
        <div className="ap-empty">
          <div className="ap-empty-title">暂无任务</div>
          <div className="ap-empty-hint">尚未注册项目——注册后自动生成每项目任务实例。</div>
        </div>
      ) : (
        runnableDefs.map((t: any) => {
          return (
            <div className="ap-ov-card" key={t.id}>
              <div className="ap-ov-row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                <div className="ap-ov-card-title">{t.title}</div>
                <button
                  type="button"
                  className="ap-btn"
                  disabled={props.busy || undefined}
                  title="立即运行（appilot_task_run）"
                  onClick={() => {
                    if (props.busy) return;
                    props.onRunTask?.(t.id);
                  }}
                >
                  {props.busy ? '运行中…' : '立即运行'}
                </button>
              </div>
              <div className="ap-ov-row">
                {chip('每 ' + t.intervalMinutes + ' 分钟', '')}
                {t.lastStatus === 'ok'
                  ? chip('上次成功', 'pass')
                  : t.lastStatus === 'error'
                    ? chip('上次失败', 'fail')
                    : chip('未运行', '')}
                {chip('已运行 ' + (t.runCount ?? 0) + ' 次', '')}
              </div>
              {t.lastRunAt ? (
                <div className="ap-wb-sub">上次运行：{new Date(t.lastRunAt).toLocaleString()}</div>
              ) : null}
              {t.nextRunAt ? (
                <div className="ap-wb-sub">下次运行：{new Date(t.nextRunAt).toLocaleString()}</div>
              ) : null}
              {t.lastSummary ? <div className="ap-wb-sub">{t.lastSummary}</div> : null}
            </div>
          );
        })
      )}
      {electronTasks.length > 0 ? (
        <details style={{ marginTop: 10 }}>
          <summary className="ap-wb-sub" style={{ cursor: 'pointer' }}>
            Electron 共享任务（{electronTasks.length} 个，镜像只读）——展开查看
          </summary>
          <div style={{ marginTop: 6 }}>
            {electronTasks.slice(0, 50).map((t: any) => (
              <div className="ap-ov-card" key={t.id} style={{ padding: '6px 10px' }}>
                <div className="ap-ov-row">
                  <div className="ap-wb-sub">{t.title}</div>
                  {t.lastStatus === 'ok'
                    ? chip('ok', 'pass')
                    : t.lastStatus === 'error'
                      ? chip('失败', 'fail')
                      : chip('未运行', '')}
                </div>
                {t.lastSummary ? <div className="ap-wb-sub">{t.lastSummary}</div> : null}
              </div>
            ))}
            {electronTasks.length > 50 ? (
              <div className="ap-wb-sub">…仅显示前 50 个（共 {electronTasks.length} 个）</div>
            ) : null}
          </div>
        </details>
      ) : null}
    </div>
  );
}

/* ────────────────────────────────────────────────
 * 全局任务中心（主面板任务页）：共享 DB 真实状态聚合视图。
 * 数据 = appilot_tasks 直读共享 DB 的 byKind/summary（error 计数等），
 * 不再按 source 只显示单侧实例——daemon 主调度下 rank/github-sync
 * 的全局 ok/error/never 一目了然。
 * ──────────────────────────────────────────────── */

const KIND_LABELS: Record<string, string> = {
  'github-sync': 'GitHub 发布同步',
  rank: '排名采集',
  '(legacy)': '旧模板任务',
};

export function GlobalTaskCenter(props: {
  node: any;
  busy?: boolean;
  checkedAt?: string | null;
  onRefresh?: () => void;
  onRunTask?: (taskId: string) => void;
}) {
  const v = overviewValue(props.node);
  const styleBox: CSSProperties = {
    border: '1px solid var(--dsw-alias-border-l2)',
    borderRadius: 12,
    padding: '10px 12px',
    marginBottom: 8,
  };
  const kvRow: CSSProperties = {
    display: 'flex',
    gap: 8,
    alignItems: 'center',
    flexWrap: 'wrap',
  };
  const fmtTime = (iso?: string) =>
    iso ? new Date(iso).toLocaleTimeString() : null;

  if (!v) {
    return (
      <div className="ap-empty">
        <div className="ap-empty-title">全局任务中心</div>
        <div className="ap-empty-hint">
          点击上方「刷新任务」，agent 会运行 appilot_tasks 直读共享数据库的任务状态。
          若长时间无数据：请先打开任意 Appilot 专属会话（对话右上角 Appilot 页签）以注册工具。
        </div>
      </div>
    );
  }

  const summary = v.summary || {};
  const byKind: Record<string, any> = v.byKind || {};
  const checkedAt = v.checkedAt || null;
  const error = Number(summary.error ?? 0);
  const total = Number(summary.total ?? 0);
  const ok = Number(summary.ok ?? 0);
  const never = Number(summary.never ?? 0);
  const kinds = Object.keys(byKind).sort();

  // github-sync 实例行（每项目一条；可经 daemon runNow 立即运行）
  const ghInstances = ((v.tasks || []) as any[]).filter(
    (t: any) => t.kind === 'github-sync',
  );

  return (
    <div>
      {/* 全局健康横幅 */}
      {error > 0 ? (
        <div
          style={{
            ...styleBox,
            borderColor: 'var(--dsw-alias-state-error-primary)',
            color: 'var(--dsw-alias-state-error-primary)',
            fontWeight: 500,
          }}
        >
          ⚠ 有 {error} 个任务实例处于失败状态（按类型见下方）——失败实例会在下一周期
          自动重试；也可用「清理并重排」/ 各项目「立即运行」处理。
        </div>
      ) : total > 0 ? (
        <div
          style={{
            ...styleBox,
            borderColor: 'var(--dsw-alias-state-success-primary)',
            color: 'var(--dsw-alias-state-success-primary)',
            fontWeight: 500,
          }}
        >
          ✓ 当前无失败任务（共 {total} 个实例，最近检查 {fmtTime(checkedAt) ?? fmtTime(props.checkedAt) ?? '—'}）
        </div>
      ) : (
        <div style={styleBox}>暂无任务实例（注册项目后自动生成）。</div>
      )}

      {/* 总览计数 */}
      <div style={styleBox}>
        <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>总览</div>
        <div style={kvRow}>
          {chip('实例 ' + total)}
          {chip('成功 ' + ok, 'pass')}
          {error > 0 ? chip('失败 ' + error, 'fail') : chip('失败 0', 'pass')}
          {chip('未运行 ' + never)}
          <span style={{ fontSize: 11, color: 'var(--dsw-alias-label-tertiary)' }}>
            数据时间 {fmtTime(checkedAt) ?? fmtTime(props.checkedAt) ?? '未知'}
          </span>
        </div>
        {props.onRefresh ? (
          <div style={{ marginTop: 8 }}>
            <button
              type="button"
              className="ap-btn"
              disabled={props.busy || undefined}
              onClick={props.onRefresh}
            >
              {props.busy ? '刷新中…' : '刷新任务'}
            </button>
          </div>
        ) : null}
      </div>

      {/* 按任务类型聚合 */}
      <div style={styleBox}>
        <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>
          按任务类型（kind × 状态）
        </div>
        {kinds.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--dsw-alias-label-tertiary)' }}>
            无按类型聚合数据
          </div>
        ) : (
          kinds.map((k) => {
            const agg = byKind[k];
            return (
              <div
                key={k}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '6px 0',
                  borderBottom: '1px solid var(--dsw-alias-border-l2)',
                }}
              >
                <span style={{ fontSize: 13 }}>
                  {KIND_LABELS[k] ?? k}
                  <span style={{ color: 'var(--dsw-alias-label-tertiary)', marginLeft: 6 }}>
                    {agg.total} 实例
                  </span>
                </span>
                <span style={{ display: 'flex', gap: 6 }}>
                  {chip('ok ' + agg.ok, 'pass')}
                  {agg.error > 0 ? chip('error ' + agg.error, 'fail') : chip('error 0', 'pass')}
                  {chip('never ' + agg.never)}
                </span>
              </div>
            );
          })
        )}
      </div>

      {/* github-sync 实例（每项目；可立即运行） */}
      {ghInstances.length > 0 && props.onRunTask ? (
        <div style={styleBox}>
          <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>
            GitHub 发布同步（每项目实例）
          </div>
          {ghInstances.map((t: any) => (
            <div key={t.id} style={{ ...kvRow, justifyContent: 'space-between', padding: '4px 0' }}>
              <span style={{ fontSize: 13 }}>
                {t.title}
                {t.lastStatus === 'ok'
                  ? chip('ok', 'pass')
                  : t.lastStatus === 'error'
                    ? chip('失败', 'fail')
                    : chip('未运行', '')}
              </span>
              <button
                type="button"
                className="ap-btn"
                disabled={props.busy || undefined}
                onClick={() => {
                  if (props.busy) return;
                  props.onRunTask?.(t.id);
                }}
              >
                立即运行
              </button>
            </div>
          ))}
        </div>
      ) : null}

      <div style={{ fontSize: 11, color: 'var(--dsw-alias-label-tertiary)' }}>
        任务数据来自 appilot_tasks（agent 直读共享 DB；可审计）。执行由租约主
        （scheduler daemon / 壳）统一调度；失败实例按周期自动重试。
      </div>
    </div>
  );
}
