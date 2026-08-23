export const STORE_STATUS_META: Record<
  string,
  { label: string; tone: "muted" | "amber" | "emerald" | "red" | "blue" }
> = {
  prepared: { label: "未提交", tone: "muted" },
  copied: { label: "已复制", tone: "blue" },
  submitted: { label: "已提交", tone: "blue" },
  in_review: { label: "审核中", tone: "amber" },
  rejected: { label: "被驳回", tone: "red" },
  released: { label: "已发布", tone: "emerald" },
};
