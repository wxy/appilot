/**
 * 休眠保持（"把手上的活干完再睡"）。
 *
 * 背景（实测）：Mac 空闲时每小时一轮 Maintenance Sleep，每轮仅 ~45s DarkWake
 * 窗口；窗口末尾入睡瞬间仍在途的请求会被冻结，直到下一次唤醒才由我们的 15s
 * 超时 abort（失败行 lastRunAt 正好落在 "Entering Sleep state" 那一秒）。
 *
 * 与其加大请求量补积压（会推高上游 429/403 风险），更稳的做法是：**停止派发
 * 新任务 + 短暂阻止系统进入这次空闲睡眠，等在途请求跑完再放行**。在途请求通常
 * 几百毫秒完成，所以每次窗口只多占用几秒（每小时 ~40s 量级），对续航影响可忽略。
 *
 * 实现：
 * - macOS：spawn `caffeinate -i -t <maxHoldSec>`（PreventUserIdleSystemSleep），
 *   释放 = kill 子进程（另带 -t 兜底自释放，防止 daemon 异常退出后残留断言）；
 * - 非 macOS：不支持（返回 no-op），此时退化为 headless 侧的易抖动分类
 *   （TRANSIENT / SLEEP-INTERRUPT，不标红 + 短退避重试）。
 *
 * 调用方（scheduler）只在「休眠窗口阶段（phase==='window'）且有待完成执行」时
 * 打开保持——用户在电脑前的清醒会话不持有，否则机器将整天不睡。
 */
export interface SleepHoldSpawned {
  kill(): void;
  /** 可选：监听退出（子进程异常结束 → 归为未持有）。 */
  once?(event: string, cb: (...args: unknown[]) => void): void;
}

export interface SleepHoldOptions {
  /** 平台（默认 process.platform；测试注入）。 */
  platform?: string;
  /** 是否启用（默认 true；false 直接 no-op）。 */
  enabled?: boolean;
  /** 单次保持上限（秒，兜底自释放；默认 180）。 */
  maxHoldSec?: number;
  /** 命令与参数（默认 macOS `caffeinate -i -t <maxHoldSec>`）；测试注入。 */
  spawn?(cmd: string, args: string[]): SleepHoldSpawned;
  log?(msg: string): void;
}

export interface SleepHold {
  /** 打开/关闭「保持唤醒」。重复调用幂等。 */
  setHold(on: boolean): void;
  isHolding(): boolean;
  /** 是否具备保持能力（平台/开关）。 */
  isAvailable(): boolean;
  /** 释放并清理（进程退出时调用）。 */
  dispose(): void;
}

/** 平台是否支持「阻止空闲睡眠」。 */
export function supportsSleepHold(platform: string = process.platform, enabled = true): boolean {
  return enabled && platform === 'darwin';
}

export function createSleepHold(opts: SleepHoldOptions = {}): SleepHold {
  const platform = opts.platform ?? process.platform;
  const maxHoldSec = opts.maxHoldSec ?? 180;
  const available = supportsSleepHold(platform, opts.enabled !== false);
  const log = opts.log ?? (() => {});
  let child: SleepHoldSpawned | null = null;
  let disposed = false;

  const spawnImpl =
    opts.spawn ??
    ((cmd: string, args: string[]): SleepHoldSpawned => {
      // 延迟 require：非 macOS 或测试环境不需要 child_process。
      const { spawn } = require('node:child_process') as typeof import('node:child_process');
      const p = spawn(cmd, args, { stdio: 'ignore' });
      return { kill: () => p.kill(), once: (ev, cb) => p.once(ev as never, cb as never) };
    });

  function release(reason: string): void {
    if (!child) return;
    try {
      child.kill();
    } catch {
      /* 已退出 */
    }
    child = null;
    log(`释放休眠保持（${reason}）`);
  }

  return {
    isAvailable: () => available,
    isHolding: () => child != null,
    setHold(on) {
      if (!available || disposed) return;
      if (on) {
        if (child) return; // 幂等
        try {
          const c = spawnImpl('caffeinate', ['-i', '-t', String(maxHoldSec)]);
          child = c;
          log(`保持唤醒：在途请求完成前延迟空闲休眠（caffeinate -i -t ${maxHoldSec}）`);
          c.once?.('exit', () => {
            if (child === c) child = null;
          });
        } catch (err: any) {
          child = null;
          log(`保持唤醒失败（忽略，退化为易抖动分类）：${err?.message || String(err)}`);
        }
      } else {
        release('无在途请求');
      }
    },
    dispose() {
      disposed = true;
      release('dispose');
    },
  };
}
