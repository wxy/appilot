import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { installHupRestart } from "../src/main/hup-restart";

{
  const signals = new EventEmitter();
  let relaunches = 0;
  let exits = 0;
  const logs: string[] = [];
  const dispose = installHupRestart(
    {
      relaunch: () => { relaunches += 1; },
      exit: (code) => {
        assert.equal(code, 0);
        exits += 1;
      },
    },
    { info: (message) => logs.push(message), error: (message) => logs.push(message) },
    signals,
  );

  signals.emit("SIGHUP");
  signals.emit("SIGHUP");
  assert.equal(relaunches, 1, "重复 HUP 不应安排多个重启实例");
  assert.equal(exits, 1);
  assert.match(logs[0], /restarting Electron/);
  dispose();
}

{
  const signals = new EventEmitter();
  let attempts = 0;
  const errors: string[] = [];
  installHupRestart(
    {
      relaunch: () => {
        attempts += 1;
        throw new Error("relaunch unavailable");
      },
      exit: () => assert.fail("relaunch 失败时不应退出"),
    },
    { info: () => {}, error: (message) => errors.push(message) },
    signals,
  );

  signals.emit("SIGHUP");
  signals.emit("SIGHUP");
  assert.equal(attempts, 2, "重启安排失败后应允许下一次 HUP 重试");
  assert.match(errors[0], /relaunch unavailable/);
}

console.log("SIGHUP 重启单测全部通过 ✓");
