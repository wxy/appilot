import {
  applyAscSnapshotToDraft,
  applyStorePublicSnapshotToDraft,
  buildStoreRebuildDraft,
  diffDraftAgainstStore,
  inferAppVersion,
} from "@appilot-labs/appilot-core/store-submission";
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

// --- Freeze snapshot: store copy is the final truth once live ---
{
  const d = {
    id: "p:prod:v1.1.1",
    productId: "prod",
    appVersion: "1.1.1",
    localizations: [
      { language: "en", locale: "en-US", name: "GloWalk", subtitle: "Path", description: "old", whatsNew: "old news", keywords: "walk" },
      { language: "zh-Hans", locale: "zh-Hans", name: "GloWalk", subtitle: "光之路", description: "旧", whatsNew: "旧闻", keywords: "走路" },
      { language: "de", locale: "de-DE", name: "GloWalk", subtitle: "Weg", description: "de", whatsNew: "n", keywords: "gehen" },
    ],
  } as any;
  const changed = applyAscSnapshotToDraft(d, [
    { locale: "en-US", name: "GloWalk: Path of Light", subtitle: "New Path", description: "new store copy", whatsNew: "new news", keywords: "walk, light" },
    { locale: "zh-Hans", name: "GloWalk", subtitle: "光之路", description: "商店新文案", whatsNew: "新新闻", keywords: "走路, 光" },
    { locale: "ja-JP", name: "未匹配语言", description: "不应写入" },
  ], "2026-08-25T00:00:00Z");
  check(changed === true, "快照覆盖返回 changed");
  check(d.localizations[0].name === "GloWalk: Path of Light" && d.localizations[0].description === "new store copy", "en-US 匹配 en 并覆盖");
  check(d.localizations[1].whatsNew === "新新闻", "zh-Hans 精确匹配覆盖");
  check(d.localizations[2].description === "de", "无 ASC 匹配的语言保持不变");
  check(d.ascSyncedAt === "2026-08-25T00:00:00Z", "冻结时间戳写入");
}
{
  const d = {
    localizations: [
      { language: "en", locale: "en-US", name: "GloWalk", subtitle: "Path", description: "same", whatsNew: "n", keywords: "k" },
    ],
  } as any;
  const changed = applyAscSnapshotToDraft(d, [
    { locale: "en-US", name: "GloWalk", subtitle: "Path", description: "same", whatsNew: "n", keywords: "k" },
  ]);
  check(changed === false && d.ascSyncedAt === undefined, "内容一致时不写时间戳");
}
{
  const d = {
    localizations: [{ language: "en", locale: "en-US", name: "GloWalk", subtitle: "Path", description: "old", whatsNew: "n", keywords: "k" }],
  } as any;
  applyAscSnapshotToDraft(d, [
    { locale: "en-US", name: "New Name" },
  ]);
  check(d.localizations[0].name === "New Name" && d.localizations[0].description === "old", "仅覆盖提供的字段");
}
{
  // ASC 空字符串不代表商店实际为空（name/subtitle 未在版本级设置时返回空），
  // 不得覆盖本地非空值——否则冻结会清空名称/副标题。
  const d = {
    localizations: [{ language: "en", locale: "en-US", name: "GloWalk", subtitle: "Path", description: "local", whatsNew: "n", keywords: "k" }],
  } as any;
  const changed = applyAscSnapshotToDraft(d, [
    { locale: "en-US", name: "", subtitle: "", description: "store desc", whatsNew: "store news", keywords: "" },
  ]);
  check(changed === true, "空可选字段 + 非空描述 → 部分变更");
  check(d.localizations[0].name === "GloWalk" && d.localizations[0].subtitle === "Path", "ASC 空名称/副标题不覆盖本地");
  check(d.localizations[0].description === "store desc" && d.localizations[0].whatsNew === "store news", "ASC 非空描述/新增内容仍覆盖");
  check(d.localizations[0].keywords === "k", "ASC 空关键词不覆盖本地");
}

// Partial freeze without ASC: per-language description/whats-new alignment.
{
  const d = {
    productId: "prod",
    appVersion: "1.1.1",
    localizations: [
      { language: "en", locale: "en-US", name: "GloWalk", subtitle: "Path", description: "local en", whatsNew: "local news", keywords: "k" },
      { language: "de", locale: "de-DE", name: "GloWalk", subtitle: "Weg", description: "lokal", whatsNew: "lokale news", keywords: "g" },
      { language: "zh-Hans", locale: "zh-Hans", name: "GloWalk", subtitle: "光之路", description: "本地", whatsNew: "本地新闻", keywords: "走" },
    ],
  } as any;
  const changed = applyStorePublicSnapshotToDraft(d, [
    { language: "en", description: "store en", whatsNew: "store news" },
    { language: "de", description: "store de" },
    { language: "ja", description: "不应写入" },
  ], "2026-08-25T00:00:00Z");
  check(changed === true, "部分冻结返回 changed");
  check(d.localizations[0].description === "store en" && d.localizations[0].whatsNew === "store news", "en 描述与新增内容对齐");
  check(d.localizations[1].description === "store de" && d.localizations[1].whatsNew === "lokale news", "de 仅覆盖提供的字段");
  check(d.localizations[2].description === "本地", "无对应语言更新时保持不变");
  check(d.localizations[0].name === "GloWalk" && d.localizations[0].keywords === "k", "名称/关键词不参与部分冻结");
  check(d.storeSyncedAt === "2026-08-25T00:00:00Z", "部分冻结时间戳写入");
}
{
  const d = {
    localizations: [{ language: "en", description: "same", whatsNew: "same" }],
  } as any;
  const changed = applyStorePublicSnapshotToDraft(d, [
    { language: "en", description: "same", whatsNew: "same" },
  ]);
  check(changed === false && d.storeSyncedAt === undefined, "内容一致时不写部分冻结时间戳");
}

// Rebuild from store: version-level + App-level localizations merge.
{
  const draft = buildStoreRebuildDraft({
    projectId: "p",
    productId: "prod",
    releaseTag: "v1.2.6",
    appVersion: "v1.2.6",
    supportedLanguages: ["en", "zh-Hans", "de"],
    versionLocalizations: [
      { locale: "en-US", name: "", subtitle: "", description: "store desc", whatsNew: "store news", keywords: "a, b", promotionalText: "> promo" },
      { locale: "zh-Hans", name: "", subtitle: "", description: "商店描述", whatsNew: "商店新闻", keywords: "甲, 乙" },
      { locale: "ja-JP", name: "", subtitle: "", description: "ja desc", whatsNew: "ja news", keywords: "j" },
    ],
    appInfoLocalizations: [
      { locale: "en-US", name: "AI Pulse: Coding Cost Tracker", subtitle: "API Cost Monitor" },
      { locale: "zh-Hans", name: "AI Pulse: 编码成本追踪", subtitle: "API 支出监控" },
    ],
    githubDraftStatus: "published",
    now: "2026-08-25T00:00:00Z",
  });
  check(draft.localizations.length === 3, "重建包含全部版本级语言");
  check(
    draft.localizations[0].language === "en" &&
      draft.localizations[0].name === "AI Pulse: Coding Cost Tracker" &&
      draft.localizations[0].subtitle === "API Cost Monitor",
    "App 级名称/副标题合并进 en",
  );
  check(
    draft.localizations[0].description === "store desc" && draft.localizations[0].keywords === "a, b",
    "版本级描述/关键词保留",
  );
  check(
    draft.localizations[1].language === "zh-Hans" && draft.localizations[1].name === "AI Pulse: 编码成本追踪",
    "zh-Hans 语言映射与名称合并",
  );
  check(draft.localizations[2].language === "ja-JP", "无匹配语言码时保留 locale 原样");
  check(draft.appVersion === "1.2.6", "版本号归一化");
  check(
    draft.masterConfirmedAt === "2026-08-25T00:00:00Z" &&
      draft.batchConfirmedAt === "2026-08-25T00:00:00Z" &&
      draft.ascSyncedAt === "2026-08-25T00:00:00Z",
    "重建文案标记为已确认且已与商店同步",
  );
  check(draft.storeStatus === "released" && draft.githubDraftStatus === "published", "重建状态标记");
  check(draft.submissionKeywords.some((k) => k.language === "zh-Hans"), "提交关键词同步重建");
}

console.log("✅ PASS: diffDraftAgainstStore 逐语言逐字段比对");
{
  const draft = {
    localizations: [
      { language: "en", name: "AI Pulse", description: "Track AI costs", whatsNew: "v2", keywords: "ai" },
      { language: "zh-Hans", name: "AI Pulse 中文", description: "追踪 AI 费用", whatsNew: "v2 中文" },
    ],
  } as any;
  const diffs = diffDraftAgainstStore(draft, [
    {
      language: "en",
      fields: {
        name: "AI Pulse",
        description: "Track AI costs faster",
        whatsNew: "v2",
        keywords: null,
      },
    },
    {
      language: "zh-Hans",
      fields: { description: "追踪 AI 费用", whatsNew: "v2 中文" },
    },
    {
      language: "ja",
      fields: { description: "日本語" },
    },
  ]);
  check(diffs.length === 1, "只统计确实不同的字段");
  check(
    diffs[0]?.language === "en" &&
      diffs[0]?.field === "description" &&
      diffs[0]?.local === "Track AI costs" &&
      diffs[0]?.store === "Track AI costs faster",
    "差异包含本地值与商店值",
  );
  check(
    diffDraftAgainstStore(draft, [
      { language: "en", fields: { description: "Track AI costs" } },
    ]).length === 0,
    "一致时无差异",
  );
}

if (errors) process.exit(1);
console.log("🎉 All store-submission tests passed!");
