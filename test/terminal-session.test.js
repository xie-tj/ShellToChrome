import test from "node:test";
import assert from "node:assert/strict";
import { TerminalSession } from "../bridge/terminal-session.js";

class FakeTerminal {
  constructor(pid) {
    this.pid = pid;
    this.writes = [];
    this.resizes = [];
    this.kills = 0;
  }

  onData(listener) {
    this.dataListener = listener;
  }

  onExit(listener) {
    this.exitListener = listener;
  }

  write(data) {
    this.writes.push(data);
  }

  resize(cols, rows) {
    this.resizes.push({ cols, rows });
  }

  kill() {
    this.kills += 1;
  }

  output(data) {
    this.dataListener(data);
  }

  exit(exitCode = 0, signal = 0) {
    this.exitListener({ exitCode, signal });
  }
}

function createHarness(overrides = {}) {
  const terminals = [];
  const events = [];
  const options = [];
  const session = new TerminalSession({
    cwd: "/workspace",
    emit: (event) => events.push(event),
    shell: "/bin/zsh",
    platform: "darwin",
    env: { HOME: "/home/test" },
    retireProcessTree: (_pid, terminal) => terminal.kill(),
    ...overrides,
    spawn: (file, args, spawnOptions) => {
      const terminal = new FakeTerminal(1000 + terminals.length);
      terminals.push(terminal);
      options.push({ file, args, spawnOptions });
      return terminal;
    },
  });
  return { session, terminals, events, options };
}

test("连接后可自动创建终端并转发输入输出", () => {
  const { session, terminals, events, options } = createHarness();

  session.start();
  session.handle({ type: "terminal.input", data: "pwd\r" });
  terminals[0].output("/workspace\r\n");

  assert.equal(terminals.length, 1);
  assert.deepEqual(terminals[0].writes, ["pwd\r"]);
  assert.deepEqual(options[0], {
    file: "/bin/zsh",
    args: ["-l"],
    spawnOptions: {
      name: "xterm-256color",
      cols: 100,
      rows: 30,
      cwd: "/workspace",
      env: { HOME: "/home/test", TERM: "xterm-256color", COLORTERM: "truecolor" },
    },
  });
  assert.deepEqual(events, [
    { type: "terminal.started", pid: 1000, reason: "initial", cols: 100, rows: 30 },
    { type: "terminal.output", data: "/workspace\r\n" },
  ]);
});

test("Windows PowerShell 不使用 Unix 登录参数", () => {
  const { session, options } = createHarness({ shell: "powershell.exe", platform: "win32" });

  session.start();

  assert.equal(options[0].file, "powershell.exe");
  assert.deepEqual(options[0].args, []);
});

test("新建和重启会替换当前终端并保留最新尺寸", () => {
  const { session, terminals, events, options } = createHarness();

  session.start();
  session.handle({ type: "terminal.resize", cols: 140, rows: 42 });
  session.handle({ type: "terminal.new" });
  session.handle({ type: "terminal.restart" });

  assert.equal(terminals.length, 3);
  assert.equal(terminals[0].kills, 1);
  assert.equal(terminals[1].kills, 1);
  assert.deepEqual(options[1].spawnOptions, {
    name: "xterm-256color",
    cols: 140,
    rows: 42,
    cwd: "/workspace",
    env: { HOME: "/home/test", TERM: "xterm-256color", COLORTERM: "truecolor" },
  });
  assert.deepEqual(
    events.filter((event) => event.type === "terminal.started").map(({ pid, reason }) => ({ pid, reason })),
    [
      { pid: 1000, reason: "initial" },
      { pid: 1001, reason: "new" },
      { pid: 1002, reason: "restart" },
    ],
  );
});

test("旧终端的延迟退出和输出不会污染替换后的终端", () => {
  const { session, terminals, events } = createHarness();

  session.start();
  session.handle({ type: "terminal.restart" });
  terminals[0].output("stale");
  terminals[0].exit(143, 15);
  terminals[1].output("current");

  assert.deepEqual(events.filter((event) => event.type === "terminal.output"), [
    { type: "terminal.output", data: "current" },
  ]);
  assert.equal(events.some((event) => event.type === "terminal.exit"), false);
});

test("关闭终端保留会话且可再次新建", () => {
  const { session, terminals, events } = createHarness();

  session.start();
  session.handle({ type: "terminal.close" });
  session.handle({ type: "terminal.input", data: "ignored" });
  session.handle({ type: "terminal.new" });

  assert.equal(terminals[0].kills, 1);
  assert.deepEqual(terminals[0].writes, []);
  assert.equal(terminals.length, 2);
  assert.equal(events.filter((event) => event.type === "terminal.closed").length, 1);
});

test("自然退出后可以重启，dispose 可以重复调用", () => {
  const { session, terminals, events } = createHarness();

  session.start();
  terminals[0].exit(7, 0);
  session.handle({ type: "terminal.restart" });
  session.dispose();
  session.dispose();

  assert.deepEqual(events.find((event) => event.type === "terminal.exit"), {
    type: "terminal.exit",
    exitCode: 7,
    signal: 0,
  });
  assert.equal(terminals[1].kills, 1);
  assert.throws(() => session.handle({ type: "terminal.new" }), /已经关闭/);
});
