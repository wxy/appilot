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

export interface LeaseSchedulerOptions {
  store: AppilotStore;
  /** 本壳身份（如 'dsh' / 'electron'）。 */
  leaderId: string;
  jobs: ScheduledJob[];
  /** 租约 TTL：主心跳过期后其他壳可接管（默认 60s，需大于 heartbeatMs）。 */
  ttlMs?: number;
  /** 心跳/抢占检查间隔（默认 15s）。 */
  heartbeatMs?: number;
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
}

export function createLeaseScheduler(opts: LeaseSchedulerOptions): LeaseScheduler {
  const { store, leaderId, jobs } = opts;
  const ttlMs = opts.ttlMs ?? 60_000;
  const heartbeatMs = opts.heartbeatMs ?? 15_000;
  const log = opts.log ?? (() => {});
  let leader = false;
  let timer: ReturnType<typeof setInterval> | null = null;
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

  function dueJobs(): ScheduledJob[] {
    const now = Date.now();
    return jobs.filter((j) => {
      const t = store.tasks.get(j.id);
      return !t || !t.nextRunAt || new Date(t.nextRunAt).getTime() <= now;
    });
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
  }

  return {
    start() {
      if (timer) return;
      tick();
      timer = setInterval(tick, heartbeatMs);
    },
    dispose() {
      if (timer) clearInterval(timer);
      timer = null;
      leader = false;
    },
    isLeader() {
      return leader;
    },
    snapshot() {
      return store.tasks.all();
    },
    async runNow(id) {
      const job = jobs.find((j) => j.id === id);
      if (!job) return undefined;
      await execute(job);
      return store.tasks.get(id);
    },
  };
}
