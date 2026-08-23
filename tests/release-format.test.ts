import {
  draftVersionLabel,
  formatVersionDate,
  mergeHistoryDrafts,
} from "../src/renderer/components/release/releaseFormat";

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

  if (errors === 0) console.log("\n🎉 All release-format tests passed!");
  else process.exitCode = 1;
}

void runTests();
