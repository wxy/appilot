/**
 * 休眠窗口感知（macOS 维护休眠 / DarkWake 循环）。
 *
 * 背景（实测，2026-09-10）：Mac 空闲时进入 1 小时一轮的 Maintenance Sleep，
 * 每轮只给约 31–46 秒 DarkWake 活跃窗口，然后立刻再次入睡。daemon 在这段窗口里
 * 派发的请求，若在入睡瞬间仍在途，会被**冻结**到下一次唤醒——届时我们自己的
 * 15s fetch 超时定时器才触发，抛 `This operation was aborted`。实测失败行的
 * lastRunAt 正好落在 "Entering Sleep state" 那一秒（如 10:22:22.769）。
 *
 * 另外每个窗口只够跑 ~22–39 次（tick 节拍 × 并发上限），而需求是 2886 次/天
 * （≈120 次/小时）→ 窗口供给不足，到期任务持续积压、每次唤醒集中爆发。
 *
 * 本模块提供纯逻辑（不依赖 Electron / 时钟环境，可单测）：
 * - 冻结检测：两次 tick 间隔异常大 ⇒ 刚经历一次休眠（woke）；
 * - 窗口长度估计：用「唤醒 → 入睡前最后一次 tick」的窗口做 EWMA；
 * - 派发裁剪：窗口末尾预留 safetyMs，不再派发新请求，避免发出即被冻结；
 * - 清醒会话识别：窗口远长于估计（用户在电脑前）时不做裁剪，照常全速；
 * - 休眠打断识别：唤醒后短时间内出现的瞬时错误判为「被休眠打断」——不计入
 *   失败连击（否则每睡一小时就把一批任务标红）。
 */

export interface SleepWindowOptions {
  /** tick 间隔超过该值 ⇒ 判定进程被冻结过（系统休眠）。默认 120s（心跳 15s）。 */
  gapMs?: number;
  /** 窗口末尾预留：留出在途请求完成的时间，默认 8s。 */
  safetyMs?: number;
  /** 首次观测前的窗口长度假设（macOS DarkWake ≈ 45s），默认 45s。 */
  defaultWindowMs?: number;
  /** 窗口长度估计的下限（防抖动，默认 10s）。 */
  minWindowMs?: number;
  /** 超过该长度的「窗口」视为正常清醒会话，不参与窗口估计（默认 10 分钟）。 */
  maxTrackedWindowMs?: number;
  /** 当前窗口时长 > awakeFactor × 估计窗口 ⇒ 判定为清醒会话（默认 4）。 */
  awakeFactor?: number;
  /** 窗口长度 EWMA 平滑系数（默认 0.4，新观测占 40%）。 */
  alpha?: number;
  /** 唤醒后这段时间内的瞬时错误判为「休眠打断」（默认 60s）。 */
  wakeGraceMs?: number;
  /** 窗口内的 tick 节拍（毫秒；用满短暂窗口的关键），默认 5s；<=0 表示不加速。 */
  burstTickMs?: number;
}

export interface SleepWindowSnapshot {
  /** unknown：尚未观测到冻结；window：处于（短）唤醒窗口；awake：清醒会话。 */
  phase: 'unknown' | 'window' | 'awake';
  /** 本轮窗口开始的时刻（毫秒）。 */
  windowStartedAtMs: number | null;
  /** 已观测到的休眠次数（冻结次数）。 */
  sleepCycles: number;
  /** 窗口长度 EWMA（毫秒）。 */
  avgWindowMs: number;
  /** 最近一次冻结时长（毫秒）。 */
  lastFrozenMs: number;
  /** 最近一次唤醒时刻。 */
  lastWakeAtMs: number | null;
  /** 被判为「休眠打断」的执行次数（累计，观测用）。 */
  sleepInterrupts: number;
  /** 是否被外部置为暂停（壳经 powerMonitor 通知系统将休眠）。 */
  suspended: boolean;
  /** 当前是否允许派发新任务。 */
  dispatchAllowed: boolean;
}

export interface SleepWindowTracker {
  /** 每个调度 tick 调用：返回本次 tick 是否刚从冻结中恢复。 */
  noteTick(nowMs: number): { woke: boolean; frozenMs: number };
  /** 现在是否应派发新任务（窗口末尾 / 暂停时为 false）。 */
  canDispatch(nowMs: number): boolean;
  /** 某次失败是否应判为「被休眠打断」（唤醒 grace 内的瞬时错误）。 */
  isSleepInterrupted(nowMs: number): boolean;
  /** 记录一次休眠打断（观测计数）。 */
  noteSleepInterrupt(): void;
  /** 外部暂停/恢复（系统休眠通知；暂停时不派发）。 */
  setSuspended(on: boolean): void;
  isSuspended(): boolean;
  snapshot(nowMs?: number): SleepWindowSnapshot;
}

const DEFAULTS = {
  gapMs: 120_000,
  safetyMs: 8_000,
  defaultWindowMs: 45_000,
  minWindowMs: 10_000,
  maxTrackedWindowMs: 10 * 60_000,
  awakeFactor: 4,
  alpha: 0.4,
  wakeGraceMs: 60_000,
  burstTickMs: 5_000,
};

export function resolveSleepWindowOptions(opts: SleepWindowOptions = {}): Required<SleepWindowOptions> {
  return { ...DEFAULTS, ...opts };
}

export function createSleepWindowTracker(opts: SleepWindowOptions = {}): SleepWindowTracker {
  const cfg = resolveSleepWindowOptions(opts);
  let lastTickAtMs: number | null = null;
  let windowStartedAtMs: number | null = null;
  let phase: SleepWindowSnapshot['phase'] = 'unknown';
  let avgWindowMs = cfg.defaultWindowMs;
  let observedWindows = 0;
  let sleepCycles = 0;
  let lastFrozenMs = 0;
  let lastWakeAtMs: number | null = null;
  let sleepInterrupts = 0;
  let suspended = false;

  function refreshPhase(nowMs: number): void {
    if (phase === 'window' && windowStartedAtMs != null) {
      // 窗口远长于估计 ⇒ 其实是在清醒会话里（用户在电脑前），停止裁剪派发。
      if (nowMs - windowStartedAtMs > cfg.awakeFactor * avgWindowMs) phase = 'awake';
    }
  }

  return {
    noteTick(nowMs) {
      const prevTick = lastTickAtMs;
      lastTickAtMs = nowMs;
      if (prevTick == null) {
        windowStartedAtMs = nowMs; // 首次：先按未知处理，不裁剪
        return { woke: false, frozenMs: 0 };
      }
      const gap = nowMs - prevTick;
      if (gap > cfg.gapMs) {
        // 冻结（休眠）→ 刚唤醒：先把上一段窗口长度纳入估计（仅短窗口，避免
        // 把「清醒几小时」当成窗口污染估计）。
        if (windowStartedAtMs != null) {
          const measured = prevTick - windowStartedAtMs;
          if (measured >= cfg.minWindowMs && measured <= cfg.maxTrackedWindowMs) {
            avgWindowMs = observedWindows === 0 ? measured : avgWindowMs * (1 - cfg.alpha) + measured * cfg.alpha;
            observedWindows += 1;
          }
        }
        sleepCycles += 1;
        lastFrozenMs = gap;
        lastWakeAtMs = nowMs;
        windowStartedAtMs = nowMs;
        phase = 'window';
        return { woke: true, frozenMs: gap };
      }
      refreshPhase(nowMs);
      return { woke: false, frozenMs: 0 };
    },

    canDispatch(nowMs) {
      if (suspended) return false;
      refreshPhase(nowMs);
      if (phase !== 'window' || windowStartedAtMs == null) return true;
      const budget = Math.max(cfg.minWindowMs, avgWindowMs - cfg.safetyMs);
      return nowMs - windowStartedAtMs < budget;
    },

    isSleepInterrupted(nowMs) {
      if (lastWakeAtMs == null || phase !== 'window') return false;
      return nowMs - lastWakeAtMs <= cfg.wakeGraceMs;
    },

    noteSleepInterrupt() {
      sleepInterrupts += 1;
    },

    setSuspended(on) {
      suspended = on;
      if (!on) {
        // 恢复：把当前时刻作为新窗口起点，重新按窗口节拍使用这段活跃时间。
        lastTickAtMs = null;
        windowStartedAtMs = null;
        phase = 'unknown';
      }
    },

    isSuspended() {
      return suspended;
    },

    snapshot(nowMs = lastTickAtMs ?? 0) {
      refreshPhase(nowMs);
      return {
        phase,
        windowStartedAtMs,
        sleepCycles,
        avgWindowMs: Math.round(avgWindowMs),
        lastFrozenMs,
        lastWakeAtMs,
        sleepInterrupts,
        suspended,
        dispatchAllowed: this.canDispatch(nowMs),
      };
    },
  };
}
