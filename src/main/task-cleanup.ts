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
    if (task.kind === "github-sync") {
      return task.projectId !== removedProjectId;
    }
    return !(task.productId && removedProductIds.has(task.productId));
  });
}
