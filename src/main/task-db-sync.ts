/**
 * Electron 调度任务状态 → 共享 SQLite tasks 表镜像（Phase 4b 后半）。
 *
 * Electron 的动态任务（rank / github-sync / ops-sync /
 * build-status，按产品×关键词拆分的数百个小任务）状态持久化在 electron-store
 * 的 'scheduledTasks'。这里把状态子集镜像进共享 DB tasks 表，使 DSH / CLI / MCP
 * （appilot-headless tasks list）能读到 Electron 的任务状态——任务真正执行仍由
 * Electron 自己的调度器跑（DB 任务行不会被 buildHeadlessJobs 的 dueJobs 误触发，
 * 因为 dueJobs 只遍历 headless 侧 job 定义）。
 *
 * 本模块不 import electron，纯映射可在 node 下单测。
 */
import type { AppilotStore, TaskRow } from '@appilot-labs/appilot-headless';

/** electron-store 'scheduledTasks' 里单个任务的最小形状。 */
export interface ElectronTaskLike {
  id?: unknown;
  kind?: unknown;
  keyword?: unknown;
  queryLanguage?: unknown;
  storefront?: unknown;
  title?: unknown;
  intervalMinutes?: unknown;
  lastRunAt?: unknown;
  nextRunAt?: unknown;
  executionCount?: unknown;
  lastStatus?: unknown;
  enabled?: unknown;
  projectId?: unknown;
  productId?: unknown;
  groupKey?: unknown;
}

const KIND_LABELS: Record<string, string> = {
  rank: '排名采集',
  'github-sync': 'GitHub 发布同步',
  'ops-sync': '数据同步',
  'build-status': '构建状态',
};

function kindLabel(kind: unknown): string {
  return typeof kind === 'string' && KIND_LABELS[kind] ? KIND_LABELS[kind] : String(kind ?? '任务');
}

function taskTitle(t: ElectronTaskLike): string {
  if (typeof t.title === 'string' && t.title) return t.title;
  if (t.kind === 'rank') {
    const kw = typeof t.keyword === 'string' ? t.keyword : '?';
    const sf = typeof t.storefront === 'string' ? t.storefront : '?';
    const lang = typeof t.queryLanguage === 'string' ? t.queryLanguage : '?';
    return `${kindLabel(t.kind)}: ${kw} @ ${sf} (${lang})`;
  }
  return kindLabel(t.kind);
}

function taskInstance(t: ElectronTaskLike): Record<string, unknown> | null {
  const kind = typeof t.kind === 'string' ? t.kind : '';
  if (kind === 'ops-sync' && typeof t.projectId === 'string') {
    return { projectId: t.projectId };
  }
  if (kind === 'build-status' && typeof t.productId === 'string') {
    return { productId: t.productId };
  }
  if (kind === 'rank' && typeof t.productId === 'string') {
    return {
      productId: t.productId,
      keyword: t.keyword,
      queryLanguage: t.queryLanguage,
      storefront: t.storefront,
      groupKey: t.groupKey,
    };
  }
  return null;
}

/** Electron 任务对象 → headless TaskRow；字段不合法返回 null（跳过）。 */
export function toTaskRow(t: ElectronTaskLike): TaskRow | null {
  if (!t || typeof t.id !== 'string' || !t.id) return null;
  if (typeof t.intervalMinutes !== 'number' || !Number.isFinite(t.intervalMinutes)) return null;
  const lastRunAt = typeof t.lastRunAt === 'string' ? t.lastRunAt : null;
  const lastStatus: TaskRow['lastStatus'] =
    t.lastStatus === 'failed'
      ? 'error'
      : lastRunAt
        ? 'ok'
        : 'never';
  const label = taskTitle(t);
  const disabled = t.enabled === false;
  return {
    id: t.id,
    title: disabled ? `${label}（已停用）` : label,
    intervalMinutes: t.intervalMinutes,
    lastRunAt,
    nextRunAt: typeof t.nextRunAt === 'string' ? t.nextRunAt : null,
    lastStatus,
    // 失败原因落盘（rank 等失败时 engine 写 lastSummary），供 DB/任务中心排查。
    lastSummary:
      typeof (t as any).lastSummary === "string" ? String((t as any).lastSummary).slice(0, 300) : null,
    runCount: typeof t.executionCount === 'number' ? t.executionCount : 0,
    source: 'electron',
    kind: typeof t.kind === 'string' ? t.kind : null,
    instance: taskInstance(t),
    enabled: !disabled,
    electronJson: JSON.stringify(t), // 无损：引擎任务重建用
  };
}

/** 由 DB 行无损重建 electron 任务（优先 electronJson，缺省按行字段推导）。 */
export function electronTaskFromRow(row: any): any | null {
  if (!row || typeof row !== 'object') return null;
  if (typeof row.electronJson === 'string' && row.electronJson) {
    try {
      const parsed = JSON.parse(row.electronJson);
      if (parsed && typeof parsed === 'object') {
        // electronJson 只保存任务的富参数；调度状态列由 daemon/CLI 持续更新，
        // 必须以列为准合并回来，否则 Electron 周期 reconcile 会用旧 JSON 覆盖新状态。
        parsed.id = row.id;
        // title 是可选富字段；原任务没有时不要把 DB 的派生展示标题注入回去，
        // 否则所谓“无损重建”会凭空改变 electron-store 对象形状。
        if (Object.prototype.hasOwnProperty.call(parsed, 'title')) {
          parsed.title = String(row.title || parsed.title || '').replace(/（已停用）$/, '');
        }
        parsed.intervalMinutes = row.intervalMinutes;
        parsed.lastRunAt = row.lastRunAt;
        parsed.nextRunAt = row.nextRunAt;
        parsed.executionCount = row.runCount || 0;
        parsed.enabled = row.enabled !== false && !String(row.title || '').includes('已停用');
        parsed.lastStatus =
          row.lastStatus === 'error'
            ? 'failed'
            : row.lastStatus === 'ok'
              ? 'success'
              : row.lastStatus ?? 'never';
        if (typeof row.lastSummary === 'string') parsed.lastSummary = row.lastSummary;
        return parsed;
      }
    } catch {
      // 落回推导
    }
  }
  const title = String(row.title || '').replace(/（已停用）$/, '');
  return {
    id: row.id,
    title,
    intervalMinutes: row.intervalMinutes,
    lastRunAt: row.lastRunAt,
    nextRunAt: row.nextRunAt,
    executionCount: row.runCount || 0,
    enabled: row.enabled !== false && !String(row.title || '').includes('已停用'),
    lastStatus:
      row.lastStatus === 'error' ? 'failed' : row.lastStatus === 'ok' ? 'success' : row.lastStatus ?? 'never',
  };
}

/**
 * 从共享 DB 恢复 Electron 调度任务。
 *
 * electronJson 是富字段快照，不是任务存在性的标志。早期迁移生成的任务行可能
 * 没有该列；这些行仍必须由列字段恢复，否则应用重启会把它们误判为“新任务”，
 * 继而重置排期和“上次执行”状态。
 */
export function electronTasksFromRows(rows: any[]): any[] {
  return (rows ?? [])
    .filter((row) => row?.source === 'electron')
    .map((row) => electronTaskFromRow(row))
    .filter((task) => task && typeof task.id === 'string');
}

export interface MirrorResult {
  mirrored: number;
  /** 清理掉的幽灵行（源里已不存在的 Electron 镜像行）。 */
  pruned: number;
}

/**
 * 把 electron-store 的调度任务镜像进共享 DB tasks 表（upsert），并清理
 * 源里已不存在的 Electron 镜像行（任务被移除/产品下架等，避免幽灵行）。
 *
 * ⚠️ 只清理 source='electron' 的行——DSH 静态任务行（source='dsh'）与 CLI
 * 触发行不受影响。Electron 启动早期 scheduledTasks 为空会触发一次全清，
 * 随后 reconcile 重建并重新镜像，最终一致。
 * 返回 { mirrored, pruned }。失败由调用方处理（此函数不做 try/catch）。
 */
export function mirrorTasksToDb(store: AppilotStore, tasks: ElectronTaskLike[]): MirrorResult {
  const sourceIds = new Set<string>();
  let mirrored = 0;
  for (const t of tasks ?? []) {
    if (!t || typeof t.id !== 'string' || !t.id) continue;
    sourceIds.add(t.id);
    const row = toTaskRow(t);
    if (!row) continue;
    store.tasks.upsert(row, { setIdentity: true });
    mirrored += 1;
  }
  // 清理：DB 中 source='electron' 但已不在当前源的任务行。
  // github-sync 已切 DB reconcile 管理；其余 Electron 富数据实例以
  // scheduledTasks 为源，源里消失时必须清理，避免产品删除后留下幽灵任务。
  // reviews-sync 已下线，但仍识别其旧镜像行：当 reconcile 从
  // scheduledTasks 移除源任务后，这里会一并清理任务表中的幽灵行。
  const mirrorManagedKinds = new Set(['rank', 'ops-sync', 'reviews-sync', 'build-status']);
  let pruned = 0;
  for (const row of store.tasks.all()) {
    const reconciledGithub =
      row.kind === 'github-sync' &&
      typeof row.instance?.projectId === 'string' &&
      typeof row.instance?.path === 'string';
    if (
      row.source === 'electron' &&
      (row.kind == null ||
        mirrorManagedKinds.has(row.kind) ||
        (row.kind === 'github-sync' && !reconciledGithub)) &&
      !sourceIds.has(row.id)
    ) {
      if (store.tasks.remove(row.id)) pruned += 1;
    }
  }
  return { mirrored, pruned };
}

/** 稳定字符串哈希（重排摊铺偏移用）。 */
function hashOf(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/**
 * 清除 electron-store 任务的失败状态（backlog #2 的 Electron 源侧）。
 * 只读纯函数：返回新数组与清除数——不清 DB（DB 由 mirrorTasksToDb 从源刷新）。
 * - clear：失败 → 无状态（lastStatus/lastRunAt 清除，nextRunAt 保留原排期）——
 *   mirror 映射为 never（未运行），任务按原排期自然重试；
 * - reschedule：同 clear + nextRunAt 限速摊铺 30–210min（id 哈希，防上游限流）。
 */
export function clearElectronFailures(
  tasks: ElectronTaskLike[],
  mode: 'clear' | 'reschedule',
): { tasks: ElectronTaskLike[]; cleared: number } {
  const reschedule = mode === 'reschedule';
  const now = Date.now();
  let cleared = 0;
  const next = (tasks ?? []).map((t) => {
    if (!t || typeof t.id !== 'string' || t.lastStatus !== 'failed') return t;
    const copy: Record<string, unknown> = { ...t };
    delete copy.lastStatus; // 无状态 → mirror 映射为 never（不再显示失败）
    delete copy.lastRunAt; // 避免 mirror 按残留 lastRunAt 误标 ok
    if (reschedule) {
      const spreadMin = 30 + (hashOf(t.id) % 180);
      copy.nextRunAt = new Date(now + spreadMin * 60_000).toISOString();
    }
    cleared += 1;
    return copy;
  });
  return { tasks: next, cleared };
}

/**
 * 用 rank_executions 回填 electron 任务行的历史执行字段（一次性/幂等）：
 * kv scheduledTasks 退役后，历史 lastRunAt/runCount/status 仅存在于 executions；
 * 仅补 lastRunAt 为 null 的行，避免覆盖后续真实更新。
 *
 * ⚠️ 复活陷阱（本函数是「清除失败后重启又复现」的根因，见 backfillTaskHistoryOnce）：
 * 「清除失败」会把 lastRunAt 置空——下次启动这里会把 rank_executions 里同一批
 * 的 failed 历史原样填回（行 error + electronJson lastStatus:'failed'），等于
 * 把用户刚清掉的失败重新标红。因此调用方必须经 backfillTaskHistoryOnce 只跑一次。
 */
export function backfillTaskHistoryFromExecutions(
  store: { tasks: { all(): any[]; upsert(row: any): void }; executions: { since(iso: string, limit?: number): Record<string, unknown>[] } },
): number {
  const rows = store.executions.since('2000-01-01T00:00:00Z', 200000);
  const stat = new Map<string, { count: number; last: string; lastStatus: string }>();
  for (const e of rows) {
    const id = String(e?.taskId ?? '');
    if (!id) continue;
    const s = stat.get(id) || { count: 0, last: '', lastStatus: '' };
    s.count += 1;
    const ts = String(e?.ts ?? '');
    if (ts > s.last) {
      s.last = ts;
      s.lastStatus = String(e?.status ?? '');
    }
    stat.set(id, s);
  }
  if (stat.size === 0) return 0;
  let patched = 0;
  for (const row of store.tasks.all()) {
    if (row?.source !== 'electron') continue;
    if (row.lastRunAt) continue; // 已有历史，跳过
    const s = stat.get(row.id);
    if (!s) continue;
    const electron = (() => {
      try {
        const t = row.electronJson ? JSON.parse(row.electronJson) : null;
        return t && typeof t === 'object' ? t : null;
      } catch {
        return null;
      }
    })();
    const lastStatus =
      s.lastStatus === 'success' ? 'ok' : s.lastStatus === 'failed' ? 'error' : 'never';
    const next = { ...row, lastRunAt: s.last, runCount: s.count, lastStatus };
    if (electron) {
      electron.lastRunAt = s.last;
      electron.executionCount = s.count;
      electron.lastStatus = s.lastStatus;
      next.electronJson = JSON.stringify(electron);
    }
    store.tasks.upsert(next);
    patched += 1;
  }
  return patched;
}

/** 历史回填「只跑一次」标记键（app_kv；kv scheduledTasks 退役迁移完成后置位）。 */
export const TASK_HISTORY_BACKFILL_MARK = "taskHistoryBackfillDone";

/** backfillTaskHistoryOnce 所需的最小 store 形状。 */
export interface TaskHistoryBackfillStore {
  kv: { get(key: string): string | undefined; set(key: string, value: string): void };
  tasks: { all(): any[]; upsert(row: any): void };
  executions: { since(iso: string, limit?: number): Record<string, unknown>[] };
}

/**
 * 历史回填封装（**只跑一次**，启动时调用）：
 * 首次（无标记）执行 backfillTaskHistoryFromExecutions 并置标记；此后每次启动
 * 直接跳过。若不跳过，用户「清除失败」把 lastRunAt 置空后，下一次启动会用
 * rank_executions 里的 failed 历史把同一批任务重新标成 error——这正是多次
 * 「清除后重启又复现 82 个失败」的根因（清除永远不粘）。标记置位后清除才真正
 * 持久。返回本次补丁行数（跳过时 0）。
 */
export function backfillTaskHistoryOnce(store: TaskHistoryBackfillStore): number {
  if (store.kv.get(TASK_HISTORY_BACKFILL_MARK)) return 0;
  const n = backfillTaskHistoryFromExecutions(
    store as Parameters<typeof backfillTaskHistoryFromExecutions>[0],
  );
  store.kv.set(TASK_HISTORY_BACKFILL_MARK, new Date().toISOString());
  return n;
}

/** 孤儿任务引用判定所需的最小 store 形状。 */
export interface OrphanPurgeStore {
  projects: { list(): { name: string; id?: string | null; path: string }[] };
  products: { listByProject(projectName: string): { productId: string }[] };
  tasks: { all(): any[]; remove(id: string): boolean };
}

/**
 * 启动兜底清理：删除引用「已删除项目/产品」的孤儿任务行（历史遗留补删）。
 *
 * 删除项目时的级联清理只覆盖删除之后的动作；此前已残留的行（如 demo 项目的
 * github-sync 实例行、已删产品的 Electron 镜像行）由这里一次性清理。
 * - 仅当注册表已有项目时执行（防首启/迁移前注册表为空导致误删全表）；
 * - 判定：instance / electronJson 里出现的 projectName、path、projectId、
 *   productId（productId 按 `${projId}:${platform}` 取前缀）只要有一个指向
 *   注册表外的项目即视为孤儿；完全没有任何项目引用的行（静态任务）一律保留；
 * - 活项目但产品已下架的行不在此删（由引擎 reconcile / mirror 清理，避免竞态）。
 * 返回被删除的任务 id 列表（幂等）。
 */
export function purgeOrphanProjectTasks(store: OrphanPurgeStore): string[] {
  const projs = store.projects.list();
  if (projs.length === 0) return [];
  const names = new Set<string>();
  const ids = new Set<string>();
  const paths = new Set<string>();
  const productIds = new Set<string>();
  for (const p of projs) {
    names.add(p.name);
    if (p.id) ids.add(p.id);
    if (p.path) paths.add(p.path);
    for (const rec of store.products.listByProject(p.name)) productIds.add(rec.productId);
  }
  const removed: string[] = [];
  for (const row of store.tasks.all()) {
    const inst = (row?.instance ?? null) as any;
    let electron: any = null;
    if (row?.electronJson) {
      try {
        const parsed = JSON.parse(row.electronJson);
        if (parsed && typeof parsed === 'object') electron = parsed;
      } catch {
        electron = null;
      }
    }
    const refNames = [inst?.projectName, electron?.projectName].filter((x) => typeof x === 'string' && x);
    const refPaths = [inst?.path, electron?.path].filter((x) => typeof x === 'string' && x);
    const refIds = [inst?.projectId, electron?.projectId].filter((x) => typeof x === 'string' && x);
    const refProducts = [inst?.productId, electron?.productId].filter((x) => typeof x === 'string' && x);
    if (refNames.length + refPaths.length + refIds.length + refProducts.length === 0) continue; // 无引用：保留
    const orphan =
      refNames.some((n) => !names.has(n)) ||
      refPaths.some((p) => !paths.has(p)) ||
      refIds.some((id) => !ids.has(id) && !names.has(id)) ||
      (refProducts.some((pid) => !productIds.has(pid)) &&
        refProducts.every((pid) => !ids.has(pid.split(':')[0]) && !names.has(pid.split(':')[0])));
    if (orphan && store.tasks.remove(row.id)) removed.push(row.id);
  }
  return removed;
}
