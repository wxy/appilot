import { inferAppVersion } from "../src/engine/store-submission";
import {
  findDraftByVersion,
  normalizeDraftIdentity,
  upsertStoreSubmissionDraft,
} from "../src/main/project-state";

let errors = 0;
function check(ok: boolean, msg: string) {
  if (ok) console.log(`✅ PASS: ${msg}`);
  else { console.error(`❌ FAIL: ${msg}`); errors++; }
}

// inferAppVersion: git tag is the primary source.
check(inferAppVersion({ tag: "v1.1.1", name: "v1.1.1" } as any) === "1.1.1", "tag v1.1.1 → 1.1.1");
check(inferAppVersion({ tag: "1.0", name: "1.0" } as any) === "1.0", "tag 1.0 → 1.0");
check(inferAppVersion({ tag: "head-abc", name: "待处理变更" } as any) === "", "无版本号 → 空");

// Untagged GitHub drafts: fall back to the release name.
check(
  inferAppVersion({ tag: "gh-1", name: "v1.2.0 WIP" } as any) === "1.2.0",
  "草案 name v1.2.0 WIP → 1.2.0",
);
check(
  inferAppVersion({ tag: "gh-1", name: "GloWalk 1.1.1" } as any) === "1.1.1",
  "草案 name GloWalk 1.1.1 → 1.1.1",
);
check(
  inferAppVersion({ tag: "gh-1", name: "no version here" } as any) === "",
  "草案 name 无版本 → 空（用户手动填写）",
);

// --- Task 4: appVersion identity ---

function draft(releaseTag: string, appVersion: string, updatedAt: string) {
  return {
    id: `p:prod:${releaseTag}`,
    projectId: "p",
    productId: "prod",
    releaseTag,
    appVersion,
    updatedAt,
  } as any;
}

const older = draft("v1.1.0", "1.1.1", "2026-08-20T10:00:00Z");
const newer = draft("v1.1.1", "1.1.1", "2026-08-21T10:00:00Z");
const other = draft("v1.2.0", "1.2.0", "2026-08-22T10:00:00Z");

{
  const project: any = { id: "p", storeSubmissionDrafts: [older, newer, other] };
  const found = findDraftByVersion(project, "prod", "1.1.1");
  check(found?.releaseTag === "v1.1.1", "按 appVersion 找到最新同版本文案");
  check(findDraftByVersion(project, "prod", "v1.1.1")?.releaseTag === "v1.1.1", "v 前缀归一化匹配");
  check(findDraftByVersion(project, "prod", "9.9.9") === null, "无匹配 → null");
  check(findDraftByVersion(project, "prod", "") === null, "空版本 → null");
  check(findDraftByVersion(project, "other", "1.1.1") === null, "其他 product 不串扰");
}

{
  // Upserting a relinked draft (same version, newer source release) replaces
  // the old entry instead of duplicating it.
  const project: any = { id: "p", storeSubmissionDrafts: [older, other] };
  upsertStoreSubmissionDraft(project, newer);
  const versions = project.storeSubmissionDrafts.map((d: any) => d.releaseTag);
  check(
    versions.includes("v1.1.1") && !versions.includes("v1.1.0"),
    "upsert 同版本去重并保留新来源",
  );
  check(versions.includes("v1.2.0"), "不同版本不受影响");
}

{
  // normalizeDraftIdentity merges legacy duplicates, keeps newest, returns changed.
  const project: any = { id: "p", storeSubmissionDrafts: [older, newer, other] };
  check(normalizeDraftIdentity(project) === true, "归一化检测到重复");
  const tags = project.storeSubmissionDrafts.map((d: any) => d.releaseTag);
  check(tags.length === 2 && tags.includes("v1.1.1") && tags.includes("v1.2.0"), "归并后每个版本一份");
  check(normalizeDraftIdentity(project) === false, "无重复时不再变更");
}

{
  // Drafts without an appVersion are preserved by normalization.
  const noVersion = draft("v1.0.0", "", "2026-08-19T10:00:00Z");
  const project: any = { id: "p", storeSubmissionDrafts: [noVersion] };
  check(normalizeDraftIdentity(project) === false && project.storeSubmissionDrafts.length === 1, "无版本草稿保留");
}

if (errors) process.exit(1);
console.log("done");
