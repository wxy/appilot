import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connect } from "node:net";
import { createInterface } from "node:readline";

if (process.platform === "win32") {
  console.log("scheduler SIGHUP 进程测试在 Windows 上跳过");
  process.exit(0);
}

const cli = join(__dirname, "..", "dist", "cli.js");
const dir = mkdtempSync(join(tmpdir(), "sched-hup-"));
const socketPath = join(dir, "scheduler.sock");

function request(method: string, timeoutMs = 2500): Promise<any> {
  return new Promise((resolve, reject) => {
    const socket = connect(socketPath);
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error(`${method} timeout`));
    }, timeoutMs);
    socket.on("connect", () => {
      socket.write(
        `${JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: method === "hello" ? { client: "hup-test", pid: process.pid } : {} })}\n`,
      );
    });
    const lines = createInterface({ input: socket });
    lines.on("line", (line) => {
      clearTimeout(timer);
      socket.destroy();
      resolve(JSON.parse(line));
    });
    lines.on("error", () => undefined);
    socket.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

async function waitForHello(timeoutMs: number): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await request("hello", 500);
      const pid = response?.result?.daemonPid;
      if (typeof pid === "number") return pid;
    } catch {
      // 重启期间 socket 会短暂不可达。
    }
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  throw new Error("daemon did not become reachable");
}

async function main(): Promise<void> {
  const daemon = spawn(process.execPath, [cli], {
    env: {
      ...process.env,
      APPILOT_DB_FILE: join(dir, "appilot.db"),
      APPILOT_SCHEDULER_UPDATE_CHECK_MS: "0",
    },
    stdio: "ignore",
  });

  const firstPid = await waitForHello(8000);
  assert.equal(firstPid, daemon.pid, "socket 应报告首个 daemon PID");

  const firstExit = new Promise<number | null>((resolve) => daemon.on("exit", resolve));
  process.kill(firstPid, "SIGHUP");
  assert.equal(
    await Promise.race([firstExit, new Promise<null>((resolve) => setTimeout(() => resolve(null), 8000))]),
    0,
    "旧 daemon 应在 HUP 后干净退出",
  );

  const replacementPid = await waitForHello(8000);
  assert.notEqual(replacementPid, firstPid, "HUP 后应由新 daemon 接管");

  await request("shutdown").catch(() => undefined);
  console.log(`scheduler SIGHUP 进程重启通过 ✓ (${firstPid} → ${replacementPid})`);
}

main().catch((error) => {
  console.error("scheduler SIGHUP 进程重启失败:", error);
  process.exit(1);
});
