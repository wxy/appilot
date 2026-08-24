export const ASC_STATE_META: Record<string, { label: string; tone: "muted" | "amber" | "emerald" | "red" | "blue" }> = {
  IN_DEVELOPMENT: { label: "开发中", tone: "muted" },
  WAITING_FOR_REVIEW: { label: "等待审核", tone: "amber" },
  IN_REVIEW: { label: "审核中", tone: "amber" },
  READY_FOR_SALE: { label: "已上架", tone: "emerald" },
  REJECTED: { label: "被拒", tone: "red" },
  DEVELOPER_REJECTED: { label: "开发者拒绝", tone: "muted" },
};

export function ascStateMeta(state: string | null | undefined) {
  if (!state) return null;
  return ASC_STATE_META[state] || { label: state, tone: "muted" as const };
}
