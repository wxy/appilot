/**
 * /appilot 斜杠命令（架构收敛：DSH 交互收敛为任意会话可用命令，取代
 * 专属会话 + 悬浮按钮）。
 *
 * 语义：handler **直读共享 SQLite**（openSharedHeadlessStore，与工具同一进程
 * 级缓存实例），输出渲染为命令行文本——不进模型、零 token、任何会话可用。
 * 这正是「任务数据在数据库里、不经对话获取」的最终形态（C4 之后 DSH 无 GUI，
 * 交互入口 = 命令 + agent 工具）。
 *
 * 子命令：
 *   /appilot                    → 用法
 *   /appilot task               → 全局任务状态摘要（byKind ok/error/never + 调度主）
 *   /appilot task clear         → 清除全部失败状态（按原排期自然重试）
 *   /appilot task reschedule    → 清除失败 + 限速摊铺重排（30–210min，防 iTunes 限流）
 */
import type { Context } from '@deepseek-ai/cordis';
import { openSharedHeadlessStore } from '@appilot-labs/appilot-common';

const KIND_LABELS: Record<string, string> = {
  'github-sync': 'GitHub 发布同步',
  rank: '排名采集',
  'ops-sync': '数据同步',
  'reviews-sync': '评论采集',
  'build-status': '构建状态',
};

const USAGE = [
  'Appilot 斜杠命令（直读共享数据库，不经模型）',
  '',
  '用法：',
  '  /appilot                       本帮助',
  '  /appilot projects              注册项目与产品（仓库/平台/跟踪关键词）',
  '  /appilot rank [项目]           排名采集概览（每产品关键词 ok/error/never + 最新采集时间）',
  '  /appilot release [项目]        GitHub 发布与发布页缓存摘要',
  '  /appilot task                  任务中心状态（各类型 ok/error/never + 失败明细）',
  '  /appilot task clear            清除全部失败状态（按原排期自然重试）',
  '  /appilot task reschedule       清除失败并限速重排（30–210 分钟内温和重跑）',
  '',
  '「项目」参数用注册仓库名（projects 首列）。评论/竞品等富数据仅存于 Electron，命令不提供。',
].join('\n');

/** 稳定字符串哈希（id → 重排摊铺偏移）。 */
function hashOf(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** 任务状态摘要（与 appilot_tasks 同一数据源，压缩为命令行文本）。 */
function taskSummary(): string {
  const store = openSharedHeadlessStore();
  const all = store.tasks.all();
  const byKind: Record<string, { total: number; ok: number; error: number; never: number }> = {};
  const failures: string[] = [];
  let ok = 0;
  let error = 0;
  let never = 0;
  for (const t of all) {
    const k = t.kind ?? '(legacy)';
    const agg = (byKind[k] ??= { total: 0, ok: 0, error: 0, never: 0 });
    agg.total++;
    if (t.lastStatus === 'ok') {
      ok++;
      agg.ok++;
    } else if (t.lastStatus === 'error') {
      error++;
      agg.error++;
      if (failures.length < 5) {
        const label = KIND_LABELS[t.kind ?? ''] ?? t.kind ?? '(legacy)';
        const msg = (t.lastSummary ?? '').slice(0, 60);
        failures.push(`  - ${label} ${t.id}${msg ? `：${msg}` : ''}`);
      }
    } else {
      never++;
      agg.never++;
    }
  }
  const leader = store.lease.leader();
  const lines: string[] = [
    `任务中心（共享 DB 直读 · 数据时间 ${new Date().toLocaleTimeString()}）`,
    `调度主：${leader ?? '无（未运行）'} · 共 ${all.length} 实例：成功 ${ok} / 失败 ${error} / 未运行 ${never}`,
  ];
  const kinds = Object.keys(byKind).sort();
  for (const k of kinds) {
    const agg = byKind[k];
    const label = KIND_LABELS[k] ?? k;
    lines.push(
      `  ${label}（${agg.total}）：ok ${agg.ok} / error ${agg.error} / never ${agg.never}`,
    );
  }
  if (error > 0) {
    lines.push(`失败明细（前 ${failures.length}）：`);
    lines.push(...failures);
    lines.push('处理：/appilot task clear（清状态）或 /appilot task reschedule（清并重排）');
  } else {
    lines.push('✓ 当前无失败任务');
  }
  return lines.join('\n');
}

/** 失败批量处理：clear / reschedule（语义与 Electron 任务中心一致）。 */
function clearFailures(reschedule: boolean): string {
  const store = openSharedHeadlessStore();
  const rows = store.tasks
    .all()
    .filter((t) => t.kind != null && t.lastStatus === 'error');
  const byKind: Record<string, number> = {};
  const now = Date.now();
  for (const r of rows) {
    const spreadMin = reschedule ? 30 + (hashOf(r.id) % 180) : 0;
    store.tasks.upsert({
      id: r.id,
      title: r.title,
      intervalMinutes: r.intervalMinutes,
      lastRunAt: r.lastRunAt,
      nextRunAt: reschedule
        ? new Date(now + spreadMin * 60_000).toISOString()
        : r.nextRunAt,
      lastStatus: 'never',
      lastSummary: null,
      runCount: r.runCount,
      source: r.source,
      kind: r.kind,
      instance: r.instance,
    });
    const k = r.kind ?? '?';
    byKind[k] = (byKind[k] ?? 0) + 1;
  }
  const detail = Object.entries(byKind)
    .map(([k, n]) => `${KIND_LABELS[k] ?? k} ${n}`)
    .join('，');
  if (rows.length === 0) {
    return '没有需要处理的失败实例 ✓';
  }
  return (
    `已${reschedule ? '清除并限速重排（30–210 分钟温和重跑）' : '清除失败状态（按原排期自然重试）'}` +
    ` ${rows.length} 个实例（${detail}）。` +
    '\n执行由调度主（daemon/壳）在到期时自动进行。'
  );
}

/** 项目/产品摘要（直读注册表 + 富数据）。 */
function projectsSummary(): string {
  const store = openSharedHeadlessStore();
  const projects = store.projects.list();
  if (projects.length === 0) return '暂无注册项目（agent 可运行 register_project 注册）。';
  const lines: string[] = [`注册项目（${projects.length}）· 数据时间 ${new Date().toLocaleTimeString()}`];
  for (const p of projects) {
    const products = store.products.listByProject(p.name);
    const kws = products.reduce(
      (s, pr) => s + (Array.isArray(pr.trackedKeywords) ? pr.trackedKeywords.length : 0),
      0,
    );
    const platforms = [...new Set(products.map((pr) => pr.platform).filter(Boolean))];
    const short = (p.path ?? '').split(/[/\\]/).filter(Boolean).pop() || p.path || '';
    lines.push(
      `• ${p.name}（${short}）· 平台 ${platforms.join('/') || p.platform || '?'} · ` +
        `产品 ${products.length} · 跟踪关键词 ${kws}`,
    );
  }
  return lines.join('\n');
}

/** 排名采集概览：每产品关键词任务状态 + 最新快照时间（可过滤项目）。 */
function rankSummary(filterProject?: string): string {
  const store = openSharedHeadlessStore();
  const latest = store.snapshots.latestCheckedAtByKey();
  const prodMeta = new Map<string, { trackName: string | null; platform: string | null; projectName: string }>();
  const projectOf = new Set<string>();
  for (const p of store.projects.list()) {
    for (const pr of store.products.listByProject(p.name)) {
      prodMeta.set(pr.productId, { trackName: pr.trackName ?? null, platform: pr.platform ?? null, projectName: p.name });
      projectOf.add(p.name);
    }
  }
  const pidOf = new Map<string, { ok: number; err: number; never: number; latest: string | null }>();
  for (const t of store.tasks.all()) {
    if (t.kind !== 'rank') continue;
    const inst = (t.instance ?? {}) as any;
    if (!inst.productId) continue;
    const e = pidOf.get(inst.productId) ?? { ok: 0, err: 0, never: 0, latest: null };
    if (t.lastStatus === 'ok') e.ok++;
    else if (t.lastStatus === 'error') e.err++;
    else e.never++;
    pidOf.set(inst.productId, e);
  }
  // 最新快照时间（productId 前缀匹配 latestCheckedAtByKey 的 key）
  for (const [key, checkedAt] of Object.entries(latest)) {
    const pid = key.split('|')[0];
    const e = pidOf.get(pid);
    if (e && (!e.latest || checkedAt > e.latest)) e.latest = checkedAt;
  }
  const time = (iso?: string | null) => (iso ? new Date(iso).toLocaleString() : '从未');
  const lines: string[] = [];
  for (const [pid, e] of [...pidOf.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const meta = prodMeta.get(pid);
    if (filterProject && meta?.projectName !== filterProject) continue;
    if (filterProject && !meta) continue;
    const name = meta?.trackName || pid;
    lines.push(
      `• ${name}（${meta?.platform ?? '?'}·${meta?.projectName ?? '?'}）：kw ${e.ok + e.err + e.never} · ` +
        `ok ${e.ok} / err ${e.err} / never ${e.never} · 最新采集 ${time(e.latest)}`,
    );
  }
  if (lines.length === 0) return `没有可展示的排名数据${filterProject ? `（项目 ${filterProject}）` : ''}。`;
  return lines.join('\n');
}

/** GitHub 发布 / 发布页缓存摘要（可过滤项目）。 */
function releaseSummary(filterProject?: string): string {
  const store = openSharedHeadlessStore();
  const projects = store.projects.list();
  const lines: string[] = [];
  for (const p of projects) {
    if (filterProject && p.name !== filterProject) continue;
    const row = store.releaseCache.get(p.name);
    if (!row) {
      lines.push(`• ${p.name}：暂无发布页缓存（github-sync 未执行/未同步）`);
      continue;
    }
    const cache = (row.cache ?? {}) as Record<string, any>;
    const releases = Array.isArray(cache.releases) ? cache.releases : [];
    const drafts = releases.filter((r: any) => r && r.draft).length;
    lines.push(
      `• ${p.name}：tag ${cache.tag ?? '无'} · GitHub 发布 ${releases.length}（草稿 ${drafts}）` +
        ` · 同步 ${row.syncedAt ? new Date(row.syncedAt).toLocaleString() : '?'}`,
    );
  }
  if (lines.length === 0) return '没有可展示的发布数据。';
  return lines.join('\n');
}

/** 项目名解析：精确 → 前缀/包含（大小写不敏感）唯一 → 返回名；多/零候选 → '__candidates__'。 */
function resolveProjectFilter(raw: string): string | '__candidates__' {
  if (!raw) return '';
  const projects = openSharedHeadlessStore().projects.list().map((p) => p.name);
  const q = raw.toLowerCase();
  const exact = projects.find((n) => n === raw);
  if (exact) return exact;
  const hits = projects.filter((n) => n.toLowerCase().includes(q));
  if (hits.length === 1) return hits[0];
  return '__candidates__';
}

export function registerAppilotCommands(ctx: Context): void {
  // 宿主未提供 commands 服务（非交互部署）→ 静默跳过，不影响工具集。
  const commands = (ctx as any).commands;
  if (!commands || typeof commands.register !== 'function') return;
  commands.register({
    name: 'appilot',
    description: 'Appilot 运营数据与任务中心（直读共享数据库，不经模型）',
    input: { hint: 'projects | rank [项目] | release [项目] | task [clear|reschedule]' },
    handler: async (inv: any) => {
      const raw = String(inv?.rawInput ?? '').trim();
      const [sub, ...rest] = raw.split(/\s+/);
      const action = String(sub || '').toLowerCase();
      try {
        if (!action) return { kind: 'success', text: USAGE };
        if (action === 'projects') return { kind: 'success', text: projectsSummary() };
        if (action === 'rank' || action === 'release') {
          const raw = String(rest[0] ?? '').trim();
          const filter = resolveProjectFilter(raw);
          if (filter === '__candidates__') {
            const names = openSharedHeadlessStore()
              .projects.list()
              .map((p) => p.name)
              .join('、');
            return {
              kind: 'error',
              text: `未匹配到项目「${raw}」。可用的项目名：${names}\n（支持前缀/包含匹配，大小写不敏感；不带项目名则显示全部）`,
            };
          }
          return {
            kind: 'success',
            text: action === 'rank' ? rankSummary(filter || undefined) : releaseSummary(filter || undefined),
          };
        }
        if (action === 'task') {
          const mode = String(rest[0] ?? '').toLowerCase();
          if (mode === 'clear') return { kind: 'success', text: clearFailures(false) };
          if (mode === 'reschedule') return { kind: 'success', text: clearFailures(true) };
          if (!mode) return { kind: 'success', text: taskSummary() };
          return {
            kind: 'error',
            text: `未知 task 参数：${mode}\n\n${USAGE}`,
          };
        }
        return { kind: 'error', text: `未知子命令：${action}\n\n${USAGE}` };
      } catch (err: any) {
        return { kind: 'error', text: `执行失败：${err?.message || String(err)}` };
      }
    },
  });
}
