import { spawn as spawnProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createClaudeStreamParser } from "./claude-stream.js";

const BASE_PROMPT = `You are connected to a local debugging cockpit. The user can see a live terminal beside this chat. Work only inside the supplied working directory. Explain important actions briefly, inspect the project before changing it, and verify fixes. This session is configured for autonomous debugging, so you may use tools without asking, but never perform destructive, irreversible, credential-related, persistence, or externally publishing actions unless the user explicitly asks in the current message.`;

export class ClaudeRunner {
  constructor({ cwd, emit, spawn = spawnProcess }) {
    this.cwd = cwd;
    this.emit = emit;
    this.spawn = spawn;
    this.active = null;
    this.sessionId = null;
  }

  ask(prompt) {
    if (this.active) {
      throw new Error("Claude 正在处理上一条消息");
    }
    if (typeof prompt !== "string" || !prompt.trim()) {
      throw new Error("请输入消息");
    }

    const turnId = randomUUID();
    const args = [
      "-p",
      "--output-format",
      "stream-json",
      "--verbose",
      "--include-partial-messages",
      "--permission-mode",
      "auto",
      "--append-system-prompt",
      BASE_PROMPT,
    ];

    if (this.sessionId) args.push("--resume", this.sessionId);
    args.push(prompt.trim());

    const child = this.spawn("claude", args, {
      cwd: this.cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    this.active = { child, turnId };
    this.emit({ type: "ai.status", state: "thinking", turnId });

    const parser = createClaudeStreamParser((event) => {
      if (event.type === "session") {
        this.sessionId = event.sessionId;
      } else if (event.type === "text") {
        this.emit({ type: "ai.delta", text: event.text, turnId });
      } else if (event.type === "tool") {
        this.emit({ type: "ai.tool", name: event.name, summary: event.summary, turnId });
      } else if (event.type === "result") {
        this.emit({ type: "ai.result", ...event, turnId });
      }
    });

    child.stdout.on("data", (chunk) => parser.push(chunk));
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      this.emit({ type: "ai.error", message: error.message, turnId });
    });

    child.on("close", (code) => {
      parser.end();
      this.active = null;
      if (code !== 0) {
        this.emit({
          type: "ai.error",
          message: stderr.trim() || `Claude Code 已退出（状态码 ${code}）`,
          turnId,
        });
      }
      this.emit({ type: "ai.status", state: "idle", turnId });
    });
  }

  stop() {
    if (!this.active) return false;
    this.active.child.kill("SIGTERM");
    return true;
  }
}
