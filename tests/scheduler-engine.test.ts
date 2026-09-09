/**
 * 调度器统一状态派生纯函数测试（架构收敛 C）：
 * deriveSchedulerEngine —— mode 仅 运行中(daemon) / 已停止 / 异常 / 启动中，
 * 不再出现「壳内/本应用(inapp)」模式。
 */
import { deriveSchedulerEngine } from "../src/main/daemon-manager";

let errors = 0;
function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`❌ FAIL: ${msg}`);
    errors++;
  } else {
    console.log(`✅ PASS: ${msg}`);
  }
}

const at = "2026-08-23T12:00:00Z";

async function runTests() {
  // daemon 在服务 → 运行中
  const running = deriveSchedulerEngine({
    userStopped: false,
    daemonRunning: true,
    ensureStatus: "ok",
    ensureError: null,
    ensureLastAttemptAt: at,
  });
  assert(running.mode === "daemon", "daemon 在服务 → mode=daemon");
  assert(running.error === null, "daemon 模式无 error");

  // 用户暂停 → 已停止（即使 daemon 租约心跳尚未过期也不显示运行）
  const stopped = deriveSchedulerEngine({
    userStopped: true,
    daemonRunning: true,
    ensureStatus: "ok",
    ensureError: null,
    ensureLastAttemptAt: at,
  });
  assert(stopped.mode === "stopped", "userStopped → mode=stopped");

  // 拉起失败 → 异常（watchdog 重试中）
  const error = deriveSchedulerEngine({
    userStopped: false,
    daemonRunning: false,
    ensureStatus: "error",
    ensureError: "scheduler did not come up within timeout",
    ensureLastAttemptAt: at,
  });
  assert(error.mode === "error", "ensure 失败 → mode=error");
  assert(error.error === "scheduler did not come up within timeout", "error 透传失败原因");
  assert(error.lastAttemptAt === at, "error 带最近尝试时刻");

  // ensure ok 但 socket 瞬断（daemon 刚退出、尚未标记错误）→ 启动中（不回滚异常）
  const starting = deriveSchedulerEngine({
    userStopped: false,
    daemonRunning: false,
    ensureStatus: "ok",
    ensureError: null,
    ensureLastAttemptAt: at,
  });
  assert(starting.mode === "starting", "未运行且无失败结论 → mode=starting");
  assert(starting.error === null, "starting 无 error");

  // 未知/冷启动（尚无 ensure 结论）→ 启动中
  const unknown = deriveSchedulerEngine({
    userStopped: false,
    daemonRunning: false,
    ensureStatus: "unknown",
    ensureError: null,
    ensureLastAttemptAt: null,
  });
  assert(unknown.mode === "starting", "未知状态 → mode=starting");

  // 模式集合不含 inapp/electron（壳内调度已移除）
  const modes = [running, stopped, error, starting, unknown].map((s) => s.mode);
  assert(
    modes.every((m) => ["daemon", "stopped", "error", "starting"].includes(m)),
    "mode 仅 daemon/stopped/error/starting（无 inapp/壳内模式）",
  );

  if (errors === 0) console.log("\n🎉 All scheduler-engine tests passed!");
  else process.exitCode = 1;
}

void runTests();
