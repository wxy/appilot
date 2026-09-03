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

  async function execute(job: ScheduledJob): Promise<void> {
    if (running.has(job.id)) return;
    running.add(job.id);
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
    } catch (err: any) {
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
    running.add(task.id);
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
    } catch (err: any) {
      store.tasks.upsert({
        ...base,
        lastRunAt: started,
        lastStatus: 'error' as const,
        lastSummary: err instanceof Error ? err.message : String(err),
      });
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
    return store.tasks
      .all()
      .filter(
        (t) =>
          t.kind != null &&
          t.kind in executors &&
          (!t.nextRunAt || new Date(t.nextRunAt).getTime() <= now),
      )
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
    for (const inst of dueInstances()) void executeInstance(inst);
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
  };
}
