import { randomBytes, timingSafeEqual } from "node:crypto";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pty from "node-pty";
import { WebSocketServer } from "ws";
import { ClaudeRunner } from "./claude-runner.js";
import {
  ALLOWED_SSH_AUTHENTICATIONS,
  createSshPolicyEnvironment,
} from "./ssh-policy.js";
import { TerminalSession } from "./terminal-session.js";
import {
  isAllowedOrigin,
  isLoopbackRequest,
  parseClientMessage,
} from "./protocol.js";

const HOST = "127.0.0.1";
const PORT = Number.parseInt(process.env.SHELL_TO_CHROME_PORT || "43110", 10);
const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WORKSPACE = path.resolve(process.env.SHELL_TO_CHROME_CWD || process.cwd());
const TERMINAL_ENV = createSshPolicyEnvironment({
  env: process.env,
  shell: process.env.SHELL,
  projectRoot: PROJECT_ROOT,
});
const connections = new Set();
const AUTH_TOKEN = process.env.SHELL_TO_CHROME_TOKEN || randomBytes(24).toString("base64url");

function hasValidToken(request) {
  try {
    const url = new URL(request.url, `http://${HOST}:${PORT}`);
    const supplied = Buffer.from(url.searchParams.get("token") || "");
    const expected = Buffer.from(AUTH_TOKEN);
    return supplied.length === expected.length && timingSafeEqual(supplied, expected);
  } catch {
    return false;
  }
}

const server = http.createServer((request, response) => {
  if (!isLoopbackRequest(request)) {
    response.writeHead(403).end("Forbidden");
    return;
  }

  if (request.url === "/health") {
    response.writeHead(200, {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    });
    response.end(
      JSON.stringify({
        ok: true,
        workspace: WORKSPACE,
        sshAuthenticationMethods: ALLOWED_SSH_AUTHENTICATIONS,
      }),
    );
    return;
  }

  response.writeHead(404).end("Not found");
});

const webSockets = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 });

server.on("upgrade", (request, socket, head) => {
  if (!isLoopbackRequest(request) || !isAllowedOrigin(request.headers.origin) || !hasValidToken(request)) {
    socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
    socket.destroy();
    return;
  }

  webSockets.handleUpgrade(request, socket, head, (client) => {
    webSockets.emit("connection", client, request);
  });
});

webSockets.on("connection", (socket) => {
  connections.add(socket);

  let cleanedUp = false;
  let terminal = null;
  let claude = null;
  const cleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    connections.delete(socket);
    claude?.stop();
    terminal?.dispose();
  };
  const send = (message) => {
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
  };

  socket.on("error", (error) => {
    console.error(`WebSocket 连接错误: ${error.message}`);
    cleanup();
  });
  socket.on("close", cleanup);

  try {
    terminal = new TerminalSession({
      cwd: WORKSPACE,
      emit: send,
      spawn: pty.spawn,
      env: TERMINAL_ENV,
    });
    claude = new ClaudeRunner({ cwd: WORKSPACE, emit: send });

    send({
      type: "bridge.ready",
      workspace: WORKSPACE,
      version: "0.1.0",
    });
    terminal.start();
  } catch (error) {
    send({ type: "bridge.error", message: `终端启动失败：${error.message}` });
    cleanup();
    socket.close(1011, "Terminal startup failed");
    return;
  }

  socket.on("message", (raw) => {
    const parsed = parseClientMessage(raw);
    if (!parsed.ok) {
      send({ type: "bridge.error", message: parsed.error });
      return;
    }

    try {
      const message = parsed.value;
      if (terminal.handle(message)) return;

      switch (message.type) {
        case "ai.ask":
          claude.ask(message.prompt);
          break;
        case "ai.stop":
          claude.stop();
          break;
        case "ping":
          send({ type: "pong", at: Date.now() });
          break;
        default:
          send({ type: "bridge.error", message: `未知消息类型：${message.type}` });
      }
    } catch (error) {
      send({ type: "bridge.error", message: error.message });
    }
  });
});

server.listen(PORT, HOST, () => {
  console.log(`\n  shellToChrome bridge 已启动`);
  console.log(`  WebSocket: ws://${HOST}:${PORT}`);
  console.log(`  连接令牌:  ${AUTH_TOKEN}`);
  console.log(`  工作目录:  ${WORKSPACE}`);
  console.log(`  SSH 认证:  ${ALLOWED_SSH_AUTHENTICATIONS.join(", ")}（托管终端内强制）`);
  console.log(`  扩展目录:  ${path.join(PROJECT_ROOT, "extension")}\n`);
});

function shutdown() {
  for (const socket of connections) socket.close(1001, "Bridge shutting down");
  webSockets.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 2_000).unref();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
