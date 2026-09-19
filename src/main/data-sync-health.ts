/**
 * 双存储镜像健康跟踪（进程内状态）：projects / tasks / blobs 的 kv → DB
 * 镜像成功/失败在此记账，供 L0 系统脉搏条暴露「数据同步异常」。
 *
 * 失败连续计数，成功即清零；进程重启后归零（镜像本身有轮询兜底自愈）。
 */

export interface DomainHealth {
  consecutiveFailures: number;
  lastErrorAt: string | null;
  lastErrorMessage: string | null;
  lastSuccessAt: string | null;
}

export interface DataSyncHealth {
  /** true = 全部域正常（或尚无镜像记录）。 */
  healthy: boolean;
  /** 连续失败 ≥1 的域（kv 键名/域标识）。 */
  failingDomains: string[];
  domains: Record<string, DomainHealth>;
}

const domains = new Map<string, DomainHealth>();

function ensure(domain: string): DomainHealth {
  let d = domains.get(domain);
  if (!d) {
    d = {
      consecutiveFailures: 0,
      lastErrorAt: null,
      lastErrorMessage: null,
      lastSuccessAt: null,
    };
    domains.set(domain, d);
  }
  return d;
}

export function recordMirrorSuccess(domain: string, at: string = new Date().toISOString()): void {
  const d = ensure(domain);
  d.consecutiveFailures = 0;
  d.lastSuccessAt = at;
  d.lastErrorMessage = null;
}

export function recordMirrorFailure(
  domain: string,
  errorMessage: string,
  at: string = new Date().toISOString(),
): void {
  const d = ensure(domain);
  d.consecutiveFailures += 1;
  d.lastErrorAt = at;
  d.lastErrorMessage = errorMessage;
}

export function getDataSyncHealth(): DataSyncHealth {
  const entries = [...domains.entries()].map(([domain, health]) => [domain, { ...health }] as const);
  const failingDomains = entries.filter(([, h]) => h.consecutiveFailures > 0).map(([domain]) => domain);
  return {
    healthy: failingDomains.length === 0,
    failingDomains,
    domains: Object.fromEntries(entries),
  };
}

/** 测试用：清空进程内状态。 */
export function resetDataSyncHealthForTest(): void {
  domains.clear();
}
