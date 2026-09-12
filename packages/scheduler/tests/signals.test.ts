import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { installSchedulerHupRestart } from "../src/signals.js";

const signals = new EventEmitter();
const reasons: Array<string | undefined> = [];
const logs: string[] = [];

const uninstall = installSchedulerHupRestart(
  { requestRestart: (reason) => reasons.push(reason) },
  (message) => logs.push(message),
  signals,
);

signals.emit("SIGHUP");
signals.emit("SIGHUP");

assert.deepEqual(reasons, ["SIGHUP"], "连续 HUP 只能发起一次重启");
assert.ok(logs.some((message) => message.includes("received SIGHUP")));

uninstall();
signals.emit("SIGHUP");
assert.equal(reasons.length, 1, "卸载后不应再响应 HUP");

const retrySignals = new EventEmitter();
let attempts = 0;
installSchedulerHupRestart(
  {
    requestRestart: () => {
      attempts += 1;
      if (attempts === 1) throw new Error("restart unavailable");
    },
  },
  (message) => logs.push(message),
  retrySignals,
);
retrySignals.emit("SIGHUP");
retrySignals.emit("SIGHUP");

assert.equal(attempts, 2, "同步提交失败后应允许下一次 HUP 重试");
assert.ok(logs.some((message) => message.includes("restart unavailable")));

console.log("scheduler SIGHUP 信号测试全部通过 ✓");
