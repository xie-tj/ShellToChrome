import test from "node:test";
import assert from "node:assert/strict";
import { createProcessTreeRetirer } from "../bridge/process-tree.js";

test("Unix 终端先终止会话进程并在宽限期后清理存活者", () => {
  const signals = [];
  const scheduled = [];
  let scan = 0;
  const terminal = { kills: 0, kill() { this.kills += 1; } };
  const retire = createProcessTreeRetirer({
    platform: "darwin",
    listSessionPids: () => (scan++ === 0 ? [101, 102] : [102]),
    signal: (pid, signal) => signals.push({ pid, signal }),
    schedule: (callback, delay) => {
      scheduled.push({ callback, delay });
      return { unref() {} };
    },
  });

  retire(101, terminal);

  assert.deepEqual(signals, [
    { pid: 101, signal: "SIGTERM" },
    { pid: 102, signal: "SIGTERM" },
    { pid: -101, signal: "SIGTERM" },
  ]);
  assert.equal(terminal.kills, 1);
  assert.equal(scheduled[0].delay, 1_000);

  scheduled[0].callback();
  assert.deepEqual(signals.at(-1), { pid: 102, signal: "SIGKILL" });
});

test("已经退出的 Unix 进程不会阻断清理", () => {
  const terminal = { kill() {} };
  const retire = createProcessTreeRetirer({
    platform: "linux",
    listSessionPids: () => [200],
    signal: () => {
      const error = new Error("gone");
      error.code = "ESRCH";
      throw error;
    },
    schedule: () => ({ unref() {} }),
    log: () => assert.fail("ESRCH 不应记录为错误"),
  });

  assert.doesNotThrow(() => retire(200, terminal));
});
