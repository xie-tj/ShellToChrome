import { execFile, execFileSync } from "node:child_process";
import os from "node:os";

const ESCALATION_DELAY_MS = 1_000;

export function createProcessTreeRetirer({
  platform = os.platform(),
  listSessionPids,
  signal = process.kill,
  schedule = setTimeout,
  log = console.error,
} = {}) {
  const listPids = listSessionPids ?? createDefaultSessionLister(platform);

  return (pid, terminal) => {
    if (platform === "win32") {
      terminal.kill();
      execFile("taskkill", ["/PID", String(pid), "/T", "/F"], (error) => {
        if (error && error.code !== 128) log(`终端进程树清理失败: ${error.message}`);
      });
      return;
    }

    const terminate = (targetPid, signalName) => {
      try {
        signal(targetPid, signalName);
      } catch (error) {
        if (error.code !== "ESRCH") log(`无法向终端进程 ${targetPid} 发送 ${signalName}: ${error.message}`);
      }
    };

    const processPids = listPids(pid);
    for (const sessionPid of processPids) terminate(sessionPid, "SIGTERM");
    terminate(-pid, "SIGTERM");
    terminal.kill();

    const timer = schedule(() => {
      for (const sessionPid of processPids) terminate(sessionPid, "SIGKILL");
    }, ESCALATION_DELAY_MS);
    timer.unref?.();
  };
}

function createDefaultSessionLister() {
  return listProcessTree;
}

function listProcessTree(rootPid) {
  const rows = readProcessTable(["-ax", "-o", "pid=", "-o", "ppid="]);
  const descendants = new Set([rootPid]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const [pid, parentPid] of rows) {
      if (descendants.has(parentPid) && !descendants.has(pid)) {
        descendants.add(pid);
        changed = true;
      }
    }
  }
  return [...descendants];
}

function readProcessTable(args) {
  try {
    const output = execFileSync("ps", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return output
      .split("\n")
      .map((line) => line.trim().split(/\s+/).map(Number))
      .filter(([pid, group]) => Number.isInteger(pid) && Number.isInteger(group));
  } catch {
    return [];
  }
}
