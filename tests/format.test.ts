import {
  formatBytes,
  formatDuration,
  formatDurationMs,
  formatElapsed,
  formatHumanTime,
  formatKilo,
  formatTokens,
  languageLabel,
  platformLabel,
} from "../src/renderer/lib/format";

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
  assert(languageLabel("en") === "英文", "languageLabel maps known codes");
  assert(languageLabel("xx") === "xx", "languageLabel falls back to the raw code");
  assert(platformLabel("ios") === "iOS" && platformLabel("macos") === "macOS", "platformLabel maps platforms");
  assert(platformLabel("other") === "未识别", "platformLabel falls back");

  assert(formatHumanTime(null) === "—", "formatHumanTime null → —");
  assert(formatHumanTime(undefined) === "—", "formatHumanTime undefined → —");
  assert(formatHumanTime(new Date(Date.now() - 20_000).toISOString()) === "刚刚", "seconds ago → 刚刚");
  assert(formatHumanTime(new Date(Date.now() + 20_000).toISOString()) === "即将", "seconds ahead → 即将");
  assert(formatHumanTime(new Date(Date.now() - 5 * 60_000).toISOString()) === "5 分钟前", "minutes ago");
  assert(formatHumanTime(new Date(Date.now() + 5 * 60_000).toISOString()) === "5 分钟后", "minutes ahead");
  assert(formatHumanTime(new Date(Date.now() - 3 * 3_600_000).toISOString()) === "3 小时前", "hours ago");

  assert(formatDurationMs(null) === "—", "formatDurationMs null → —");
  assert(formatDurationMs(500) === "500 毫秒", "milliseconds");
  assert(formatDurationMs(3200) === "3.2 秒", "seconds");
  assert(formatDurationMs(90_000) === "1 分 30 秒", "minutes + seconds");

  assert(formatKilo(0) === "0K字", "formatKilo zero");
  assert(formatKilo(1000) === "1K字", "formatKilo exact K");
  assert(formatKilo(1250) === "1.3K字", "formatKilo decimal");
  assert(formatTokens(500) === "500", "formatTokens small");
  assert(formatTokens(2500) === "2.5K", "formatTokens K");
  assert(formatBytes(0) === "0B", "formatBytes zero");
  assert(formatBytes(512) === "512B", "formatBytes bytes");
  assert(formatBytes(2048) === "2.0KB", "formatBytes KB");
  assert(formatBytes(3 * 1024 * 1024) === "3.0MB", "formatBytes MB");
  assert(formatDuration(0) === "—", "formatDuration zero → —");
  assert(formatDuration(800) === "800ms", "formatDuration ms");
  assert(formatDuration(2500) === "2.5s", "formatDuration s");
  assert(formatElapsed(45) === "45秒", "formatElapsed seconds");
  assert(formatElapsed(65) === "1分05秒", "formatElapsed minute+seconds");
  assert(formatElapsed(120) === "2分", "formatElapsed whole minutes");

  if (errors === 0) console.log("\n🎉 All format tests passed!");
  else process.exitCode = 1;
}

void runTests();
