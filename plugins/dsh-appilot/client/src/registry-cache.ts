/**
 * 注册表共享缓存 + 过期自动刷新。
 *
 * 背景：list_projects 结果以会话节点形式存在，节点是「运行时的点快照」；
 * 旧节点会挡住自动刷新（组件误以为已有数据）。本模块：
 * - 记录最近一次注册表结果与时间戳（模块级，跨组件共享）；
 * - `maybeRefreshRegistry`：缓存缺失或超过 MAX_AGE 才触发一次 list_projects
 *   （带 inflight 去重），组件挂载/打开时调用即可，无需手动刷新。
 */

export const REGISTRY_LIST_PROMPT = '请运行 list_projects，列出所有已注册的 Appilot 项目。';

/** 缓存有效期：30 秒内不重复触发 agent 查询。 */
export const REGISTRY_MAX_AGE_MS = 30_000;

let cache: { at: number; value: any } | null = null;
let inflight: Promise<unknown> | null = null;

/** 最近一次注册表结果（{ count, projects } 或 null）。 */
export function getRegistryCache(): any {
  return cache ? cache.value : null;
}

/** 组件观察到新的 list_projects 节点时更新缓存。 */
export function setRegistryCache(value: any): void {
  cache = { at: Date.now(), value };
}

export function registryIsStale(): boolean {
  return !cache || Date.now() - cache.at > REGISTRY_MAX_AGE_MS;
}

/**
 * 缓存过期时触发一次注册表刷新（经 run 发送提示词给 agent）。
 * 幂等：in-flight 或缓存未过期时不重复触发。
 */
export function maybeRefreshRegistry(run: (prompt: string) => Promise<unknown>): void {
  if (inflight) return;
  if (!registryIsStale()) return;
  inflight = Promise.resolve(run(REGISTRY_LIST_PROMPT))
    .catch(() => {})
    .then(() => {
      inflight = null;
    });
}
