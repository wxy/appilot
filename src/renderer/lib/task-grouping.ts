/**
 * Pure grouping key for scheduler tasks shown in the task center.
 *
 * - rank tasks group by their scheduler round (product × platform × language
 *   × storefront), so the round-progress column stays meaningful;
 * - github-sync / ops-sync are project-scoped;
 * - reviews-sync / build-status are product-scoped.
 */
export function taskGroupKey(task: {
  kind?: string;
  groupKey?: string | null;
  projectName?: string;
  productName?: string;
}): string {
  const kind = task.kind || "unknown";
  if (kind === "rank" && task.groupKey) return `rank\u0000${task.groupKey}`;
  if (kind === "github-sync" || kind === "ops-sync") {
    return `sync\u0000${task.projectName || ""}`;
  }
  return `${task.projectName || ""}\u0000${task.productName || ""}\u0000${kind}`;
}
