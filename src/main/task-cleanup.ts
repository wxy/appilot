/**
 * Pure task-list filtering for project deletion (unit-testable, no Electron).
 */

export interface ScheduledTaskLike {
  kind: string;
  productId?: string;
  projectId?: string;
}

/** Tasks that must be removed when a project (and its products) is deleted. */
export function filterTasksForRemovedProject<T extends ScheduledTaskLike>(
  tasks: T[],
  removedProductIds: Set<string>,
  removedProjectId: string,
): T[] {
  return tasks.filter((task) => {
    // 项目级任务（github-sync / ops-sync 等）按 projectId 关联，必须按项目删除；
    // 此前只识别 github-sync，被删项目的 ops-sync 会残留在任务池里。
    if (task.projectId) {
      return task.projectId !== removedProjectId;
    }
    return !(task.productId && removedProductIds.has(task.productId));
  });
}
