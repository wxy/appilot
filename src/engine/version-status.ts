/**
 * Version status derivation — single source of truth for "where is this
 * version in its release lifecycle".
 *
 * First-principles rules:
 * - ASC (when credentials are configured and data was fetched) is the
 *   authoritative source: exact states, matched by versionString.
 * - Without ASC, the public iTunes lookup can only confirm the *current*
 *   live version; everything else must be labelled unknown, never denied.
 * - Unknown is expressed as "未确认", never as "未上架"/"未提交".
 *
 * This module is pure (no Electron/network); the renderer imports it for
 * badge derivation, the main process feeds it fetched data.
 */

export type VersionStatusSource = "asc" | "store-lookup" | "none";

export interface VersionStatus {
  key:
    | "not-in-asc" // ASC fetched, but no versionString matches appVersion
    | "in-development" // IN_DEVELOPMENT
    | "waiting-review" // WAITING_FOR_REVIEW
    | "in-review" // IN_REVIEW
    | "ready-for-sale" // READY_FOR_SALE
    | "rejected" // REJECTED / DEVELOPER_REJECTED
    | "store-live" // no ASC; store current version == appVersion
    | "unknown"; // no source can confirm
  label: string;
  tone: "muted" | "amber" | "emerald" | "red" | "blue";
  source: VersionStatusSource;
}

export interface AscVersionLike {
  versionString: string;
  appStoreState?: string | null;
}

const ASC_STATE_META: Record<
  string,
  { key: VersionStatus["key"]; label: string; tone: VersionStatus["tone"] }
> = {
  IN_DEVELOPMENT: { key: "in-development", label: "开发中（未提交审核）", tone: "muted" },
  WAITING_FOR_REVIEW: { key: "waiting-review", label: "等待审核", tone: "amber" },
  IN_REVIEW: { key: "in-review", label: "审核中", tone: "amber" },
  READY_FOR_SALE: { key: "ready-for-sale", label: "已上架", tone: "emerald" },
  REJECTED: { key: "rejected", label: "被拒", tone: "red" },
  DEVELOPER_REJECTED: { key: "rejected", label: "开发者拒绝", tone: "red" },
};

export function deriveVersionStatus(input: {
  appVersion: string;
  ascVersions?: AscVersionLike[] | null;
  storeCurrentVersion?: string | null;
}): VersionStatus {
  const version = String(input.appVersion || "").trim();
  if (!version) {
    return { key: "unknown", label: "未确认", tone: "muted", source: "none" };
  }

  const ascVersions = Array.isArray(input.ascVersions) ? input.ascVersions : null;
  if (ascVersions) {
    const match = ascVersions.find(
      (item) => String(item.versionString || "").trim() === version,
    );
    if (!match) {
      return { key: "not-in-asc", label: "ASC 未创建该版本", tone: "amber", source: "asc" };
    }
    const meta = ASC_STATE_META[String(match.appStoreState || "")];
    if (meta) {
      return { key: meta.key, label: meta.label, tone: meta.tone, source: "asc" };
    }
    return {
      key: "unknown",
      label: `ASC 状态未知（${String(match.appStoreState || "无")}）`,
      tone: "muted",
      source: "asc",
    };
  }

  const storeVersion = String(input.storeCurrentVersion || "").trim();
  if (storeVersion && storeVersion === version) {
    return {
      key: "store-live",
      label: "商店：当前已上架",
      tone: "emerald",
      source: "store-lookup",
    };
  }

  return { key: "unknown", label: "未确认（配置 ASC 后可查看）", tone: "muted", source: "none" };
}
