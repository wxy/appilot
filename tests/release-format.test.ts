import {
  draftVersionLabel,
  formatVersionDate,
  groupHistoryDrafts,
  mergeHistoryDrafts,
  releaseStoreFacts,
  storeReleaseDateForVersion,
} from "../src/renderer/components/release/releaseFormat";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { HistoryViewer } from "../src/renderer/components/release/HistoryViewer";
import { HistoryPanel } from "../src/renderer/components/release/HistoryPanel";
import { ReleaseReadinessPanel } from "../src/renderer/components/release/ReleaseReadinessPanel";
import "./store-product-scope.test";

let errors = 0;
function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`❌ FAIL: ${msg}`);
    errors++;
  } else {
    console.log(`✅ PASS: ${msg}`);
  }
}

async function runTests() {
  assert(formatVersionDate("") === "", "formatVersionDate empty");
  assert(formatVersionDate("not-a-date") === "", "formatVersionDate invalid");
  assert(
    /^\d{1,2}\/\d{1,2} \d{2}:\d{2}$/.test(formatVersionDate("2026-08-23T10:30:00Z")),
    "formatVersionDate renders month/day + time",
  );

  assert(draftVersionLabel({ releaseTag: "1.2.6" }) === "v1.2.6", "draftVersionLabel adds v");
  assert(draftVersionLabel({ releaseTag: "v1.2.6" }) === "v1.2.6", "draftVersionLabel keeps v");
  assert(draftVersionLabel({ appVersion: "2.0" }) === "v2.0", "draftVersionLabel from appVersion");
  assert(draftVersionLabel({ releaseTag: "some-tag", updatedAt: "2026-08-23T10:30:00Z" }) !== "未知版本", "tag fallback to date");
  assert(draftVersionLabel({}) === "未知版本", "draftVersionLabel unknown");
  assert(
    storeReleaseDateForVersion("2.0.0", "2.0.0", "2026-09-22T00:00:00Z") === "2026-09-22T00:00:00Z",
    "上架日期仅与它所属的当前商店版本配对",
  );
  assert(
    storeReleaseDateForVersion("2.0.0", "1.9.0", "2026-09-01T00:00:00Z") === null,
    "不同版本的公开商店日期不会被误标为当前版本上架时间",
  );
  const iosStoreFacts = releaseStoreFacts("2.0.0", {
    versions: [{ id: "ios-v2", platform: "IOS", versionString: "2.0.0", appStoreState: "READY_FOR_SALE", buildId: "ios-b2" }],
    builds: [{ id: "ios-b2", version: "2", processingState: "VALID" }],
  }, null, true);
  const macStoreFacts = releaseStoreFacts("2.0.0", {
    versions: [{ id: "mac-v2", platform: "MAC_OS", versionString: "2.0.0", appStoreState: "IN_REVIEW", buildId: "mac-b2" }],
    builds: [{ id: "mac-b2", version: "2", processingState: "PROCESSING" }],
  }, null, true);
  assert(iosStoreFacts.versionStatus?.label === "已上架" && iosStoreFacts.buildInfo?.label === "构建可用", "iOS 使用本平台的版本和构建状态");
  assert(macStoreFacts.versionStatus?.label === "审核中" && macStoreFacts.buildInfo?.label === "构建处理中", "macOS 不复用 iOS 的上架和构建状态");

  const earlier = { releaseTag: "v1.0", updatedAt: "2026-01-01T00:00:00Z", localizations: [{ language: "en", name: "a" }] };
  const laterSameTag = {
    releaseTag: "v1.0",
    updatedAt: "2026-02-01T00:00:00Z",
    localizations: [{ language: "zh-Hans", name: "b" }],
  };
  const merged = mergeHistoryDrafts([earlier, laterSameTag]);
  assert(merged.length === 1, "mergeHistoryDrafts merges same releaseTag");
  assert(merged[0].updatedAt === laterSameTag.updatedAt, "merge keeps the latest updatedAt");
  assert(merged[0].localizations.length === 2, "merge consolidates localizations by language");

  const merged2 = mergeHistoryDrafts([
    { releaseTag: "v1.0", updatedAt: "2026-01-01T00:00:00Z", localizations: [{ language: "en" }] },
    { releaseTag: "v1.1", updatedAt: "2026-02-01T00:00:00Z", localizations: [{ language: "en" }] },
  ]);
  assert(merged2.length === 2, "merge keeps distinct tags separate");
  assert(merged2[0].releaseTag === "v1.1", "merge sorts newest first");

  const revisionGroups = groupHistoryDrafts([
    { id: "r1", productId: "ios", appVersion: "1.2.0", revisionNumber: 1, batchConfirmedAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" },
    { id: "r2", productId: "ios", appVersion: "1.2.0", revisionNumber: 2, batchConfirmedAt: "2026-02-01T00:00:00Z", updatedAt: "2026-02-01T00:00:00Z" },
    { id: "r3", productId: "ios", appVersion: "1.2.0", revisionNumber: 3, updatedAt: "2026-03-01T00:00:00Z" },
  ]);
  assert(revisionGroups.length === 1, "同一版本的修订只占一个一级列表项");
  assert(revisionGroups[0].current.id === "r2", "最新定稿修订成为当前文案");
  assert(revisionGroups[0].working?.id === "r3", "未定稿修订附属于当前文案");
  assert(revisionGroups[0].history[0].id === "r1", "旧定稿进入修订历史");

  const revisionListMarkup = renderToStaticMarkup(createElement(HistoryPanel, {
    drafts: [revisionGroups[0].current, revisionGroups[0].working, ...revisionGroups[0].history],
    currentDraftId: "r2",
    onSelect: () => undefined,
    onCreateRevision: () => undefined,
    onContinueRevision: () => undefined,
  }));
  assert((revisionListMarkup.match(/v1\.2\.0/g) || []).length === 1, "文案列表同一版本只渲染一个一级标题");
  assert(revisionListMarkup.includes("继续修订"), "存在工作修订时显示继续入口");
  assert(revisionListMarkup.includes("历史修订 1 份"), "旧定稿折叠进修订历史");

  const historyMarkup = renderToStaticMarkup(createElement(HistoryViewer, {
    draft: {
      id: "draft-1",
      releaseTag: "v1.2.0",
      updatedAt: "2026-09-15T00:00:00Z",
      localizations: [
        { language: "en", name: "App", description: "English" },
        { language: "ja", name: "アプリ", description: "日本語" },
      ],
    },
  }));
  assert(
    (historyMarkup.match(/text-emerald-500/g) || []).length === 2,
    "历史商店文案为每个已有翻译显示勾选标记",
  );

  const finalizedMarkup = renderToStaticMarkup(createElement(HistoryViewer, {
    draft: {
      id: "draft-final",
      releaseTag: "v2.0.0",
      updatedAt: "2026-09-22T00:00:00Z",
      batchConfirmedAt: "2026-09-22T00:00:00Z",
      localizations: [{ language: "en", name: "App", description: "Final" }],
    },
    onCreateRevision: () => undefined,
  }));
  assert(finalizedMarkup.includes("创建修订稿"), "只读定稿页提供创建修订稿入口");

  const flowMarkup = renderToStaticMarkup(createElement(ReleaseReadinessPanel, {
    githubNode: createElement("span", null, "GitHub ready"),
    platformFlows: [
      { key: "ios", label: "iOS", copyNode: createElement("span", null, "iOS copy") },
      { key: "macos", label: "macOS", copyNode: createElement("span", null, "macOS copy") },
    ],
  }));
  assert(flowMarkup.includes("iOS") && flowMarkup.includes("macOS"), "多平台发布流程同时展示每个平台线路");

  if (errors === 0) console.log("\n🎉 All release-format tests passed!");
  else process.exitCode = 1;
}

void runTests();
