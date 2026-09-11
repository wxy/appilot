/**
 * 任务行 ↔ 项目 关联判定（纯逻辑、无 electron 依赖）。
 *
 * 共享 DB tasks 行不存 projectName 列，项目与任务的关联藏在
 * id / title / kind / instance JSON（{ projectName, path, projectId, productId… }）。
 * 删除项目后需据此清理残留任务，避免"项目没了任务还在跑、一跑就报错"。
 */
export interface TaskLike {
  id: string;
  title?: string | null;
  kind?: string | null;
  instance?: Record<string, unknown> | null;
}

export interface ProjectRef {
  /** 稳定 projects.id；v14 起任务身份优先使用它。 */
  id?: string | null;
  /** electron project.name（registry name / projectName）。 */
  name: string;
  /** electron project.localPath。 */
  path?: string | null;
  /** 被删产品的 product.id 集合。 */
  productIds?: string[];
}

export function normalizePathRef(p: string): string {
  return (p || '').replace(/[/\\]+$/, '');
}

export function taskReferencesProject(task: TaskLike, ref: ProjectRef): boolean {
  if (!task || typeof task !== 'object') return false;
  const projectId = ref.id || '';
  const name = ref.name;
  const path = normalizePathRef(ref.path || '');
  const productIds = ref.productIds || [];
  const inst = (task.instance && typeof task.instance === 'object' ? task.instance : {}) as Record<string, unknown>;
  const id = task.id || '';

  const matchesStableId =
    Boolean(projectId) &&
    (inst.projectId === projectId ||
      id === `github-sync:${projectId}` ||
      id.startsWith(`${projectId}:`));
  // name 分支只为清理由 v14 之前留下的任务。新任务不再以名称作为身份。
  const matchesName =
    name &&
    (inst.projectName === name ||
      inst.name === name ||
      id.startsWith(`${name}:`) ||
      id === `github-sync:${name}`);
  const matchesPath =
    Boolean(path) && normalizePathRef(String(inst.path ?? '')) === path;
  const matchesProduct =
    productIds.length > 0 &&
    productIds.some(
      (pid) =>
        inst.productId === pid ||
        id.startsWith(`${pid}:`),
    );
  return Boolean(matchesStableId || matchesName || matchesPath || matchesProduct);
}
