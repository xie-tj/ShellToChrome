import os from "node:os";
import { createProcessTreeRetirer } from "./process-tree.js";
import { sanitizeDimensions } from "./protocol.js";

const MAX_INPUT_LENGTH = 64_000;

export class TerminalSession {
  constructor({
    cwd,
    emit,
    spawn,
    shell = process.env.SHELL || (os.platform() === "win32" ? "powershell.exe" : "/bin/zsh"),
    platform = os.platform(),
    retireProcessTree = createProcessTreeRetirer({ platform }),
    env = process.env,
    cols = 100,
    rows = 30,
  }) {
    this.cwd = cwd;
    this.emit = emit;
    this.spawn = spawn;
    this.shell = shell;
    this.platform = platform;
    this.retireProcessTree = retireProcessTree;
    this.env = env;
    this.size = sanitizeDimensions(cols, rows);
    this.terminal = null;
    this.generation = 0;
    this.disposed = false;
  }

  start(reason = "initial") {
    this.#assertAvailable();
    this.#retireCurrent();

    const generation = ++this.generation;
    const terminal = this.spawn(this.shell, this.platform === "win32" ? [] : ["-l"], {
      name: "xterm-256color",
      ...this.size,
      cwd: this.cwd,
      env: {
        ...this.env,
        TERM: "xterm-256color",
        COLORTERM: "truecolor",
      },
    });
    this.terminal = terminal;

    terminal.onData((data) => {
      if (this.#isCurrent(terminal, generation)) {
        this.emit({ type: "terminal.output", data });
      }
    });
    terminal.onExit(({ exitCode, signal }) => {
      if (!this.#isCurrent(terminal, generation)) return;
      this.terminal = null;
      this.emit({ type: "terminal.exit", exitCode, signal });
    });

    this.emit({
      type: "terminal.started",
      pid: terminal.pid,
      reason,
      ...this.size,
    });
  }

  handle(message) {
    this.#assertAvailable();

    switch (message.type) {
      case "terminal.input":
        if (typeof message.data === "string" && message.data.length <= MAX_INPUT_LENGTH) {
          this.terminal?.write(message.data);
        }
        break;
      case "terminal.resize":
        this.size = sanitizeDimensions(message.cols, message.rows);
        this.terminal?.resize(this.size.cols, this.size.rows);
        break;
      case "terminal.new":
        this.start("new");
        break;
      case "terminal.restart":
        this.start("restart");
        break;
      case "terminal.close":
        this.close();
        break;
      default:
        return false;
    }

    return true;
  }

  close() {
    this.#assertAvailable();
    const hadTerminal = Boolean(this.terminal);
    this.#retireCurrent();
    if (hadTerminal) this.emit({ type: "terminal.closed" });
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.#retireCurrent();
  }

  #retireCurrent() {
    const terminal = this.terminal;
    if (!terminal) return;
    this.terminal = null;
    this.generation += 1;
    this.retireProcessTree(terminal.pid, terminal);
  }

  #isCurrent(terminal, generation) {
    return !this.disposed && this.terminal === terminal && this.generation === generation;
  }

  #assertAvailable() {
    if (this.disposed) throw new Error("终端会话已经关闭");
  }
}
