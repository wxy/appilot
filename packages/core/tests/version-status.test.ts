import { ascStoreLiveVersion, deriveVersionStatus } from "../src/version-status";

let errors = 0;
function check(ok: boolean, msg: string) {
  if (ok) console.log(`✅ PASS: ${msg}`);
  else { console.error(`❌ FAIL: ${msg}`); errors++; }
}

// Empty / missing appVersion
check(deriveVersionStatus({ appVersion: "" }).key === "unknown", "空版本 → unknown");
check(deriveVersionStatus({ appVersion: "  " }).label === "未确认", "空白版本 → 未确认");
check(deriveVersionStatus({ appVersion: "1.1.1" }).source === "none", "无任何来源 → none");

// ASC exact states
check(
  deriveVersionStatus({ appVersion: "1.1.1", ascVersions: [{ versionString: "1.1.1", appStoreState: "IN_DEVELOPMENT" }] }).key === "in-development",
  "IN_DEVELOPMENT → in-development",
);
check(
  deriveVersionStatus({ appVersion: "1.1.1", ascVersions: [{ versionString: "1.1.1", appStoreState: "IN_DEVELOPMENT" }] }).label === "开发中（未提交审核）",
  "IN_DEVELOPMENT label",
);
check(
  deriveVersionStatus({ appVersion: "1.1.1", ascVersions: [{ versionString: "1.1.1", appStoreState: "WAITING_FOR_REVIEW" }] }).key === "waiting-review",
  "WAITING_FOR_REVIEW → waiting-review",
);
check(
  deriveVersionStatus({ appVersion: "1.1.1", ascVersions: [{ versionString: "1.1.1", appStoreState: "IN_REVIEW" }] }).key === "in-review",
  "IN_REVIEW → in-review",
);
const live = deriveVersionStatus({
  appVersion: "1.1.1",
  ascVersions: [{ versionString: "1.1.1", appStoreState: "READY_FOR_SALE" }],
});
check(live.key === "ready-for-sale" && live.tone === "emerald" && live.source === "asc", "READY_FOR_SALE → 已上架/emerald/asc");
check(
  deriveVersionStatus({ appVersion: "1.1.1", ascVersions: [{ versionString: "1.1.1", appStoreState: "REJECTED" }] }).key === "rejected",
  "REJECTED → rejected",
);
check(
  deriveVersionStatus({ appVersion: "1.1.1", ascVersions: [{ versionString: "1.1.1", appStoreState: "DEVELOPER_REJECTED" }] }).key === "rejected",
  "DEVELOPER_REJECTED → rejected",
);

// ASC fetched but no match → not-in-asc (never a denial of "not live")
check(
  deriveVersionStatus({ appVersion: "1.2.0", ascVersions: [{ versionString: "1.1.1", appStoreState: "READY_FOR_SALE" }] }).key === "not-in-asc",
  "ASC 无匹配 → not-in-asc",
);
check(
  deriveVersionStatus({ appVersion: "1.2.0", ascVersions: [] }).key === "not-in-asc",
  "ASC 空列表 → not-in-asc",
);
check(
  deriveVersionStatus({ appVersion: "1.2.0", ascVersions: [{ versionString: "1.1.1", appStoreState: "READY_FOR_SALE" }] }).source === "asc",
  "not-in-asc 来源为 asc",
);

// Unknown ASC state string → labelled unknown, source still asc
const oddState = deriveVersionStatus({
  appVersion: "1.1.1",
  ascVersions: [{ versionString: "1.1.1", appStoreState: "SOME_NEW_STATE" }],
});
check(oddState.key === "unknown" && oddState.source === "asc", "未知 ASC 状态 → unknown（source=asc）");

// Store lookup fallback (no ASC)
check(
  deriveVersionStatus({ appVersion: "1.1.1", storeCurrentVersion: "1.1.1" }).key === "store-live",
  "商店当前版本命中 → store-live",
);
check(
  deriveVersionStatus({ appVersion: "1.1.1", storeCurrentVersion: "1.1.1" }).source === "store-lookup",
  "store-live 来源为 store-lookup",
);
check(
  deriveVersionStatus({ appVersion: "1.1.1", storeCurrentVersion: "1.2.0" }).key === "unknown",
  "商店当前版本不匹配 → unknown（不否定）",
);
check(
  deriveVersionStatus({ appVersion: "1.1.1", storeCurrentVersion: null }).key === "unknown",
  "无商店数据 → unknown",
);

// ASC takes precedence over store lookup
const both = deriveVersionStatus({
  appVersion: "1.1.1",
  ascVersions: [{ versionString: "1.1.1", appStoreState: "IN_REVIEW" }],
  storeCurrentVersion: "1.1.1",
});
check(both.key === "in-review" && both.source === "asc", "ASC 优先于商店查询");

// Store live version derived from ASC (newest READY_FOR_SALE by createdDate).
check(
  ascStoreLiveVersion([
    { versionString: "1.0", appStoreState: "READY_FOR_SALE", createdDate: "2026-07-01T00:00:00Z" },
    { versionString: "1.1.1", appStoreState: "READY_FOR_SALE", createdDate: "2026-08-20T00:00:00Z" },
    { versionString: "1.2.0", appStoreState: "IN_REVIEW", createdDate: "2026-08-25T00:00:00Z" },
  ]) === "1.1.1",
  "商店当前版本 = 最新 READY_FOR_SALE（排除审核中）",
);
check(
  ascStoreLiveVersion([{ versionString: "1.0", appStoreState: "READY_FOR_SALE" }]) === "1.0",
  "单个已上架版本",
);
check(
  ascStoreLiveVersion([{ versionString: "1.2.0", appStoreState: "IN_REVIEW" }]) === null,
  "无已上架版本 → null",
);
check(ascStoreLiveVersion([]) === null, "空列表 → null");
check(ascStoreLiveVersion(null) === null, "null → null");
check(
  ascStoreLiveVersion([{ versionString: "1.1.1", appStoreState: "READY_FOR_SALE", createdDate: null }]) === "1.1.1",
  "createdDate 缺失仍可返回版本",
);

if (errors) process.exit(1);
console.log("done");
