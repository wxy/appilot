/**
 * scheduler-fingerprint 纯逻辑测试：磁盘指纹（sha1/file/CLI 解析注入）与
 * schedulerManager 派生（mode / unknown / mismatch）。
 */
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  sha1Hex,
  fileContentFingerprint,
  diskSchedulerFingerprint,
  deriveSchedulerManager,
} from "../src/main/scheduler-fingerprint";

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
  // ── 哈希 / 文件指纹 ──
  const sha = sha1Hex("appilot-scheduler");
  assert(/^[0-9a-f]{40}$/.test(sha), "sha1Hex 输出 40 位十六进制");
  assert(sha1Hex("appilot-scheduler") === sha, "sha1Hex 确定性");
  assert(sha1Hex("a") !== sha, "不同内容哈希不同");

  const dir = mkdtempSync(join(tmpdir(), "fp-"));
  const file = join(dir, "cli.js");
  writeFileSync(file, "console.log('v1')");
  const fp1 = fileContentFingerprint(file);
  assert(fp1 !== null, "可读文件返回指纹");
  assert(fileContentFingerprint(join(dir, "missing.js")) === null, "缺失文件 → null");
  writeFileSync(file, "console.log('v2') // updated");
  const fp2 = fileContentFingerprint(file);
  assert(fp2 !== null && fp2 !== fp1, "文件内容变化 → 指纹变化");
  assert(fp1 === diskSchedulerFingerprint(() => file) || fp2 === diskSchedulerFingerprint(() => file), "注入解析器 = 文件指纹");
  rmSync(dir, { recursive: true, force: true });

  // 注入解析器各分支
  assert(diskSchedulerFingerprint(null) === null, "解析器为 null → 磁盘指纹 null");
  assert(diskSchedulerFingerprint(() => null) === null, "解析失败 → null");
  assert(fileContentFingerprint(join(dir, "missing.js")) === null, "删除后 → null");

  const tmp2 = mkdtempSync(join(tmpdir(), "fp2-"));
  const real = join(tmp2, "entry.js");
  writeFileSync(real, "module.exports = 1;");
  const realFp = diskSchedulerFingerprint(() => real);
  assert(realFp === sha1Hex("module.exports = 1;"), "磁盘指纹 = 入口文件内容 sha1");
  rmSync(tmp2, { recursive: true, force: true });

  // ── deriveSchedulerManager：模式 + unknown/mismatch ──
  const running = "a".repeat(40);
  const disk = "b".repeat(40);
  const diskSame = running;

  const daemonMatch = deriveSchedulerManager({
    daemonRunning: true,
    shellRunning: false,
    userStopped: false,
    runningFingerprint: running,
    diskFingerprint: diskSame,
  });
  assert(daemonMatch.mode === "daemon", "daemon 在跑 → mode=daemon");
  assert(daemonMatch.unknown === false, "双指纹已知 → unknown=false");
  assert(daemonMatch.mismatch === false, "指纹一致 → mismatch=false");
  assert(daemonMatch.runningFingerprint === running, "runningFingerprint 透传");

  const daemonMismatch = deriveSchedulerManager({
    daemonRunning: true,
    shellRunning: false,
    userStopped: false,
    runningFingerprint: running,
    diskFingerprint: disk,
  });
  assert(daemonMismatch.mode === "daemon" && daemonMismatch.mismatch === true, "运行≠磁盘 → mismatch=true");
  assert(daemonMismatch.unknown === false, "双指纹已知 → unknown=false");

  const daemonUnknownRun = deriveSchedulerManager({
    daemonRunning: true,
    shellRunning: false,
    userStopped: false,
    runningFingerprint: null,
    diskFingerprint: disk,
  });
  assert(daemonUnknownRun.unknown === true && daemonUnknownRun.mismatch === false, "运行指纹未知 → unknown=true");

  const daemonUnknownDisk = deriveSchedulerManager({
    daemonRunning: true,
    shellRunning: false,
    userStopped: false,
    runningFingerprint: running,
    diskFingerprint: null,
  });
  assert(daemonUnknownDisk.unknown === true && daemonUnknownDisk.mismatch === false, "磁盘指纹不可得 → unknown=true");

  const stoppedByUser = deriveSchedulerManager({
    daemonRunning: true, // 用户停止后租约心跳短暂未过期也不显示 daemon 模式
    shellRunning: false,
    userStopped: true,
    runningFingerprint: running,
    diskFingerprint: disk,
  });
  assert(stoppedByUser.mode === "stopped", "userStopped → mode=stopped");
  assert(stoppedByUser.mismatch === false && stoppedByUser.unknown === false, "stopped 模式不产生 mismatch/unknown");

  const inApp = deriveSchedulerManager({
    daemonRunning: false,
    shellRunning: true,
    userStopped: false,
    runningFingerprint: null,
    diskFingerprint: disk,
  });
  assert(inApp.mode === "inapp", "electron 壳调度 → mode=inapp");
  assert(inApp.mismatch === false && inApp.unknown === false, "inapp 不产生 mismatch/unknown（daemon 未跑）");

  const idle = deriveSchedulerManager({
    daemonRunning: false,
    shellRunning: false,
    userStopped: false,
    runningFingerprint: null,
    diskFingerprint: disk,
  });
  assert(idle.mode === "stopped" && idle.unknown === false, "全停 → mode=stopped");

  if (errors === 0) console.log("\n🎉 All scheduler-fingerprint tests passed!");
  else process.exitCode = 1;
}

void runTests();
