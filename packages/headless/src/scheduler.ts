/**
 * Headless 租约选主调度器（Phase 3）。
 *
 * 多个壳（Electron / DSH）嵌入同一 headless + 打开同一 SQLite：谁持有租约谁是
 * 唯一调度主——只有主的 tick 会执行任务，从者只做心跳/抢占检查，主崩溃后自动接管。
 * 任务状态持久化在 store.tasks（lastRunAt/nextRunAt/status/summary/runCount）。
 *
 * 一致性：租约 = lease 表单行（leaderId + heartbeatAt）。acquire 在事务内检查
 * 心跳是否过期（TTL），先到者为主。主每 heartbeatMs 续租；心跳过期即视为崩溃，
 * 从者在下一个 tick 抢占接管（延迟 ≤ TTL + heartbeatMs）。
 */
import type { AppilotStore } from './store.js';
import type { TaskRow } from './schema.js';
import { formatItunesBlockClock, isItunesSearchForbidden } from '@appilot-labs/appilot-core/rank-collector';
import {
  armItunesSearchBlockStore,
  isItunesSearchBlockedStore,
  itunesSearchBlockedUntilStore,
  itunesSearchBlockSkipSummary,
} from './itunes-breaker.js';

/**
 * 限流类失败判定（教训 C 落码）：上游临时限制（HTTP 403/429 / rate limit /
 * too many requests）≠ 业务错误——失败实例应短退避自动重试，而非等同业务
 * 错误推回整周期（rank 曾因 iTunes IP 限流全池 403）。
 */
export function isRateLimitError(message: string): boolean {
  return /(\b403\b|\b429\b|rate.?limit|too many requests)/i.test(message || '');
}

/**
 * 限流退避分钟（指数增长）：5 → 10 → 20 → 40 → 80 → 160 min（streak 封顶 6），
 * 且不超过任务自身周期/3h——既给上游冷却时间，又不把实例推过正常周期太多。
 */
export function rateLimitBackoffMinutes(streak: number, intervalMinutes: number): number {
  const exp = 5 * 2 ** Math.max(0, Math.min(streak - 1, 5));
  return Math.min(exp, 180, intervalMinutes || 180);
}

/** 实例执行最大并发（网络型任务；超出留待下个 tick——任务仍到期不会丢）。 */
export const MAX_INFLIGHT_INSTANCES = 10;

/** iTunes 熔断「自动跳过」日志节流（避免重复路径每 tick 刷屏）。 */
const ITUNES_BLOCK_SKIP_LOG_INTERVAL_MS = 60_000;
let lastItunesBlockSkipLogAt = 0;


export interface ScheduledJobContext {
  store: AppilotStore;
  log(msg: string): void;
}

export interface ScheduledJob {
  id: string;
  title: string;
  intervalMinutes: number;
  /** 执行任务；返回摘要。需幂等（可能被 leader 重试/接管后重跑）。 */
  run(ctx: ScheduledJobContext): Promise<string>;
}

/**
 * 实例任务执行器（v4）：任务行（DB tasks，带 kind + instance 参数）由核心
 * 执行器按 kind 分发执行——Electron / DSH 的任务收敛为同一 DB 实例 + 同一
 * 执行器，不存在壳特有任务。
 */
export interface TaskExecutorContext extends ScheduledJobContext {
  /** 当前实例任务行（含 kind / instance 参数）。 */
  task: TaskRow;
}

export interface TaskExecutor {
  /** 默认标题（reconcile seed 用）。 */
  title: string;
  /** 默认间隔（分钟；reconcile seed 用）。 */
  intervalMinutes: number;
  /**
   * 该执行器是否请求 iTunes Search API（/search）。为 true 时受 403 熔断约束：
   * 熔断期内不派发（自动与显式触发均跳过），执行中命中 403 会写熔断键并停掉
   * 后续自动派发。当前仅 rank 执行器置位；github-sync 走 GitHub API 不受约束。
   */
  hitsItunesSearch?: boolean;
  /** 执行该实例；返回摘要。需幂等。 */
  run(ctx: TaskExecutorContext): Promise<string>;
}

export interface LeaseSchedulerOptions {
  store: AppilotStore;
  /** 本壳身份（如 'dsh' / 'electron'）。 */
  leaderId: string;
  jobs: ScheduledJob[];
  /** v4 实例任务执行器：kind → 执行器；DB 中 kind 在此且到期的任务行由主 tick 执行。 */
  executors?: Record<string, TaskExecutor>;
  /** 租约 TTL：主心跳过期后其他壳可接管（默认 60s，需大于 heartbeatMs）。 */
  ttlMs?: number;
  /** 心跳/抢占检查间隔（默认 15s）。 */
  heartbeatMs?: number;
  /** 加速模式参数（可选；提供即启用 setAccel 能力）。 */
  accel?: SchedulerAccelOptions;
  log?(msg: string): void;
}

export interface LeaseScheduler {
  start(): void;
  dispose(): void;
  isLeader(): boolean;
  /** 任务状态快照（db.tasks）。 */
  snapshot(): TaskRow[];
  /** 立即运行一个任务（显式触发；非主也可用）。 */
  runNow(id: string): Promise<TaskRow | undefined>;
  /**
   * 加速模式（P5-1）：主 tick 间隔缩短 + 每轮实例上限放大（催快积压）。
   * 非主时无副作用（从者不调度）。返回当前是否处于加速。
   */
  setAccel(on: boolean): boolean;
  /** 当前是否加速。 */
  isAccel(): boolean;
  /**
   * 本调度器实例的执行统计（内存计数；架构收敛 B：daemon 自维护状态的数据源）。
   * 口径见 SchedulerStats 注释——只统计「本进程实际执行」（到期/runNow），
   * 不统计被熔断跳过 / 并发去重拦截的执行。
   */
  stats(): SchedulerStats;
  /** 立即跑一轮 tick（仅主生效；供 daemon socket runDue 用）。 */
  kick(): void;
}

/**
 * 调度器执行统计（每次请求实时快照；本进程内存计数，重启归零）。
 * - processed：执行尝试次数（开始执行即计，含失败；到期 tick + runNow 同口径）；
 * - succeeded / failed：按执行结果分类（与任务行 lastStatus 一致语义）；
 * - uniqueTasks：处理过的不同任务 id 数（processedTasks 口径，daemon 状态复用）；
 * - processedToday：按本地日期滚动的「今天已执行」计数；
 * - lastRunAt：最近一次执行开始时间（ISO）。
 */
export interface SchedulerStats {
  /** 本调度器实例创建时间（ISO；daemon 状态 startedAt 用）。 */
  startedAt: string;
  processed: number;
  succeeded: number;
  failed: number;
  uniqueTasks: number;
  processedToday: number;
  lastRunAt: string | null;
}

/** 本地日期键（yyyy-MM-dd；processedToday 日滚动用，纯函数便于测试）。 */
export function localDayKey(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** 加速模式参数（opt-in）。 */
export interface SchedulerAccelOptions {
  /** 加速时 tick 间隔（默认 2000ms）。 */
  tickMs?: number;
  /** 加速时每轮实例上限（默认 100）。 */
  tickLimit?: number;
}

export function createLeaseScheduler(opts: LeaseSchedulerOptions): LeaseScheduler {
  const { store, leaderId, jobs } = opts;
  const executors = opts.executors ?? {};
  const ttlMs = opts.ttlMs ?? 60_000;
  const heartbeatMs = opts.heartbeatMs ?? 15_000;
  const accelOpts = opts.accel ?? { tickMs: 2000, tickLimit: 100 };
  const log = opts.log ?? (() => {});
  let leader = false;
  let timer: ReturnType<typeof setInterval> | null = null;
  let accel = false;
  const running = new Set<string>();

  // ── 执行统计（架构收敛 B：daemon 自维护状态在 headless 调度循环处的累计点）──
  // 计数发生在 execute/executeInstance 真正开始执行实例时（并发去重/熔断跳过不
  // 计数）；成功/失败在 try/catch 落定后分类。全部为本进程内存变量——daemon 是
  // 唯一调度执行体时即「本 daemon」计数；重启归零（daemon status 一并暴露
  // startedAt/uptime，口径见 SchedulerStats）。
  const statsState = {
    startedAt: new Date().toISOString(),
    processed: 0,
    succeeded: 0,
    failed: 0,
    processedToday: 0,
    todayKey: localDayKey(new Date()),
    lastRunAt: null as string | null,
  };
  const seenTaskIds = new Set<string>();
  function statsNoteStart(taskId: string): void {
    statsState.processed += 1;
    seenTaskIds.add(taskId);
    const key = localDayKey(new Date());
    if (key !== statsState.todayKey) {
      statsState.todayKey = key;
      statsState.processedToday = 0;
    }
    statsState.processedToday += 1;
    statsState.lastRunAt = new Date().toISOString();
  }
  function schedulerStats(): SchedulerStats {
    return {
      startedAt: statsState.startedAt,
      processed: statsState.processed,
      succeeded: statsState.succeeded,
      failed: statsState.failed,
      uniqueTasks: seenTaskIds.size,
      processedToday: statsState.processedToday,
      lastRunAt: statsState.lastRunAt,
    };
  }

  async function execute(job: ScheduledJob): Promise<void> {
    if (running.has(job.id)) return;
    running.add(job.id);
    statsNoteStart(job.id);
    const started = new Date().toISOString();
    const prev = store.tasks.get(job.id);
    const base = {
      id: job.id,
      title: job.title,
      intervalMinutes: job.intervalMinutes,
      nextRunAt: new Date(Date.now() + job.intervalMinutes * 60_000).toISOString(),
      runCount: (prev?.runCount ?? 0) + 1,
    };
    try {
      const summary = await job.run({ store, log });
      store.tasks.upsert({
        ...base,
        lastRunAt: started,
        lastStatus: 'ok' as const,
        lastSummary: summary,
      });
      statsState.succeeded += 1;
    } catch (err: any) {
      statsState.failed += 1;
      store.tasks.upsert({
        ...base,
        lastRunAt: started,
        lastStatus: 'error' as const,
        lastSummary: err instanceof Error ? err.message : String(err),
      });
    } finally {
      running.delete(job.id);
    }
  }

  /** 执行一个 DB 实例任务行（v4：kind 在 executors）。状态写回保留 kind/instance。 */
  async function executeInstance(task: TaskRow): Promise<void> {
    const executor = task.kind ? executors[task.kind] : undefined;
    if (!executor || running.has(task.id)) return;
    // iTunes Search 403 熔断（与主进程同键/45min 冷却，见 itunes-breaker.ts）：
    // 冷却期内不执行 hitsItunesSearch 执行器（当前仅 rank）。跳过语义 = 保留
    // nextRunAt/lastStatus/runCount（任务维持到期态，解除后自动补跑），仅当摘要
    // 有变化时写一次说明性 lastSummary；显式 runNow 走这里同样被拦。非该 API
    // 的执行器（github-sync 等）不受影响。
    if (executor.hitsItunesSearch === true && isItunesSearchBlockedStore(store)) {
      const nowLog = Date.now();
      if (nowLog - lastItunesBlockSkipLogAt >= ITUNES_BLOCK_SKIP_LOG_INTERVAL_MS) {
        lastItunesBlockSkipLogAt = nowLog;
        const untilIso = itunesSearchBlockedUntilStore(store);
        log(
          `[scheduler:${leaderId}] iTunes Search 熔断中——${task.id} 自动跳过` +
            (untilIso ? `（冷却至 ${formatItunesBlockClock(untilIso)}）` : ''),
        );
      }
      const summary = itunesSearchBlockSkipSummary(store);
      const prevRow = store.tasks.get(task.id);
      if (prevRow && prevRow.lastSummary !== summary) {
        store.tasks.upsert({ ...prevRow, lastSummary: summary });
      }
      return;
    }
    running.add(task.id);
    statsNoteStart(task.id);
    const started = new Date().toISOString();
    const base = {
      id: task.id,
      title: task.title || executor.title,
      intervalMinutes: task.intervalMinutes || executor.intervalMinutes,
      nextRunAt: new Date(Date.now() + (task.intervalMinutes || executor.intervalMinutes) * 60_000).toISOString(),
      runCount: (task.runCount ?? 0) + 1,
      source: task.source,
      kind: task.kind,
      instance: task.instance,
    };
    try {
      const summary = await executor.run({ store, log, task });
      store.tasks.upsert({
        ...base,
        lastRunAt: started,
        lastStatus: 'ok' as const,
        lastSummary: summary,
      });
      statsState.succeeded += 1;
    } catch (err: any) {
      const msg = err instanceof Error ? err.message : String(err);
      // iTunes Search 403（被拒/封禁/风控）→ 写熔断键（与主进程同键、45 分钟）。
      // 同批已在途实例 ≤ MAX_INFLIGHT 并发无法中途取消；键生效后本 tick 剩余与
      // 后续 tick 均不再派发，等效「停止该批剩余 rank」，避免持续请求使情况恶化。
      //
      // 且**不落 error 状态**（#269 教训落码）：403 是上游风控而非应用故障。若照
      // 常写 lastStatus:'error'，每次冷却（45min）结束后到期实例自动补跑再遇 403
      // 会再次写红行——用户「清除失败」后同批 403 又复现，清除永远不粘。此分支与
      // 派发前熔断跳过同语义：保留任务原状态/nextRunAt/runCount/lastRunAt（解除
      // 冷却后到期自然补跑），仅当摘要变化时写一条说明性 lastSummary 作为痕迹。
      // daemon 级失败计数仍 +1（运行确实以失败告终，与限流类同口径）；不影响
      // 任务行状态，因此任务中心失败列表/横幅不会再生。
      if (executor.hitsItunesSearch === true && isItunesSearchForbidden(err)) {
        if (armItunesSearchBlockStore(store)) {
          log(
            `[scheduler:${leaderId}] iTunes Search 403 熔断触发（${task.id}）——` +
              '暂停自动 rank 采集 45 分钟',
          );
        }
        const blockSummary = itunesSearchBlockSkipSummary(store);
        const prevRow = store.tasks.get(task.id);
        if (prevRow && prevRow.lastSummary !== blockSummary) {
          store.tasks.upsert({ ...prevRow, lastSummary: blockSummary });
        }
        statsState.failed += 1;
        return;
      }
      const rateLimited = isRateLimitError(msg);
      let nextRunAt = base.nextRunAt;
      let lastSummary = msg;
      if (rateLimited) {
        // 限流：指数短退避自动重试（连续限流 streak 累进，RATELIMIT:n 标记），
        // 而非把实例推回整个 interval（教训 C——曾全池 403 需等 12h 才重试）。
        const prev = store.tasks.get(task.id);
        const prevMatch = /^RATELIMIT:(\d+)/.exec((prev && prev.lastSummary) || '');
        const streak = prevMatch ? Number(prevMatch[1]) + 1 : 1;
        lastSummary = `RATELIMIT:${streak}: ${msg}`;
        nextRunAt = new Date(
          Date.now() + rateLimitBackoffMinutes(streak, base.intervalMinutes) * 60_000,
        ).toISOString();
      }
      store.tasks.upsert({
        ...base,
        nextRunAt,
        lastRunAt: started,
        lastStatus: 'error' as const,
        lastSummary,
      });
      statsState.failed += 1;
    } finally {
      running.delete(task.id);
    }
  }

  function dueJobs(): ScheduledJob[] {
    const now = Date.now();
    return jobs.filter((j) => {
      const t = store.tasks.get(j.id);
      return !t || !t.nextRunAt || new Date(t.nextRunAt).getTime() <= now;
    });
  }

  /** DB 中 kind 在 executors 且到期的实例任务（v4）。 */
  function dueInstances(): TaskRow[] {
    if (Object.keys(executors).length === 0) return [];
    const now = Date.now();
    // iTunes Search 403 熔断：冷却期内不派发 hitsItunesSearch 执行器的到期实例
    //（保持到期态，解除后首个 tick 自然补跑）；显式 runNow 由 executeInstance
    // 前置检查拦下。非该 API 的实例照常派发。
    const itunesBlocked = isItunesSearchBlockedStore(store, now);
    return store.tasks
      .all()
      .filter((t) => {
        if (t.kind == null || !(t.kind in executors)) return false;
        const executor = executors[t.kind];
        if (executor.hitsItunesSearch === true && itunesBlocked) return false;
        return !t.nextRunAt || new Date(t.nextRunAt).getTime() <= now;
      })
      .slice(0, accel ? (accelOpts.tickLimit ?? 100) : 20); // 单 tick 上限（加速放大）
  }

  /** 单次 tick：主 → 续租 + 跑到期任务；从 → 尝试抢占。 */
  function tick(): void {
    if (leader) {
      if (!store.lease.heartbeat(leaderId)) {
        leader = false;
        log(`[scheduler:${leaderId}] leadership lost`);
        return;
      }
    } else if (store.lease.acquire(leaderId, ttlMs)) {
      leader = true;
      log(`[scheduler:${leaderId}] became schedule leader`);
    } else {
      return; // 存在活主，等待其过期
    }
    for (const job of dueJobs()) void execute(job);
    // 并发上限：避免网络型实例（github-sync/rank）执行堆积叠加触发上游限流
    // （教训 B——全量到期时 tick 叠加曾把 iTunes 打到 IP 级 403）。
    for (const inst of dueInstances()) {
      if (running.size >= MAX_INFLIGHT_INSTANCES) break;
      void executeInstance(inst);
    }
  }

  function restartTimer(): void {
    if (timer) clearInterval(timer);
    timer = setInterval(tick, accel ? (accelOpts.tickMs ?? 2000) : heartbeatMs);
  }

  return {
    start() {
      if (timer) return;
      tick();
      restartTimer();
    },
    setAccel(on) {
      accel = on;
      if (timer) restartTimer(); // 立即应用新节拍
      if (on) {
        log(`[scheduler:${leaderId}] accel on`);
        tick(); // 立刻多跑一轮
      } else {
        log(`[scheduler:${leaderId}] accel off`);
      }
      return accel;
    },
    isAccel() {
      return accel;
    },
    dispose() {
      if (timer) clearInterval(timer);
      timer = null;
      leader = false;
      accel = false;
    },
    isLeader() {
      return leader;
    },
    snapshot() {
      return store.tasks.all();
    },
    async runNow(id) {
      const job = jobs.find((j) => j.id === id);
      if (job) {
        await execute(job);
        return store.tasks.get(id);
      }
      // v4：DB 实例任务（kind 在 executors）显式触发
      const row = store.tasks.get(id);
      if (row && row.kind && row.kind in executors) {
        await executeInstance(row);
        return store.tasks.get(id);
      }
      return undefined;
    },
    stats() {
      return schedulerStats();
    },
    kick() {
      tick();
    },
  };
}
