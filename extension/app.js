/* global Terminal, FitAddon */

const extensionStorage = globalThis.chrome?.storage?.local ?? {
  async get(key) {
    const value = localStorage.getItem(key);
    return { [key]: value ? JSON.parse(value) : undefined };
  },
  async set(values) {
    for (const [key, value] of Object.entries(values)) {
      localStorage.setItem(key, JSON.stringify(value));
    }
  },
};

const elements = {
  workspace: document.querySelector("#workspacePath"),
  connection: document.querySelector("#connectionBadge"),
  terminalPid: document.querySelector("#terminalPid"),
  newTerminal: document.querySelector("#newTerminalButton"),
  restartTerminal: document.querySelector("#restartTerminalButton"),
  closeTerminal: document.querySelector("#closeTerminalButton"),
  clear: document.querySelector("#clearButton"),
  settingsButton: document.querySelector("#settingsButton"),
  settingsCloseButton: document.querySelector("#settingsCloseButton"),
  settingsCancelButton: document.querySelector("#settingsCancelButton"),
  dialog: document.querySelector("#settingsDialog"),
  settingsForm: document.querySelector("#settingsForm"),
  bridgeUrl: document.querySelector("#bridgeUrl"),
  bridgeToken: document.querySelector("#bridgeToken"),
  conversation: document.querySelector("#conversation"),
  emptyState: document.querySelector("#emptyState"),
  promptForm: document.querySelector("#promptForm"),
  promptInput: document.querySelector("#promptInput"),
  sendButton: document.querySelector("#sendButton"),
  stopButton: document.querySelector("#stopButton"),
  aiStatus: document.querySelector("#aiStatus"),
};

const terminal = new Terminal({
  cursorBlink: true,
  cursorStyle: "bar",
  fontFamily: '"SFMono-Regular", Menlo, Consolas, monospace',
  fontSize: 13,
  lineHeight: 1.35,
  letterSpacing: 0,
  scrollback: 10_000,
  convertEol: true,
  theme: {
    background: "#0d1423",
    foreground: "#dce6f5",
    cursor: "#49d7c7",
    cursorAccent: "#0d1423",
    selectionBackground: "#35558588",
    black: "#151c2c",
    red: "#ef7477",
    green: "#64d3ad",
    yellow: "#eec36c",
    blue: "#6d96ff",
    magenta: "#c38cf2",
    cyan: "#54dacc",
    white: "#dce6f5",
    brightBlack: "#778399",
    brightRed: "#ff9496",
    brightGreen: "#83e4c1",
    brightYellow: "#ffda89",
    brightBlue: "#8babff",
    brightMagenta: "#d7a9fa",
    brightCyan: "#75ebdf",
    brightWhite: "#ffffff",
  },
});
const fitAddon = new FitAddon.FitAddon();
terminal.loadAddon(fitAddon);
terminal.open(document.querySelector("#terminal"));
fitAddon.fit();
terminal.writeln("\x1b[38;2;73;215;199m›\x1b[0m 等待本地桥接程序……\r\n");

let socket = null;
let reconnectTimer = null;
let config = { url: "ws://127.0.0.1:43110", token: "" };
let activeAssistantBody = null;
let aiBusy = false;
let terminalActive = false;
let focusTerminalOnStart = false;

function send(message) {
  if (!socket || socket.readyState !== WebSocket.OPEN) return false;
  socket.send(JSON.stringify(message));
  return true;
}

function setConnection(state, text) {
  elements.connection.className = `connection-badge is-${state}`;
  elements.connection.querySelector("b").textContent = text;
  updateTerminalControls();
}

function updateTerminalControls() {
  const connected = socket?.readyState === WebSocket.OPEN;
  elements.newTerminal.disabled = !connected;
  elements.restartTerminal.disabled = !connected;
  elements.closeTerminal.disabled = !connected || !terminalActive;
}

function setTerminalActive(active) {
  terminalActive = active;
  if (!active) elements.terminalPid.textContent = "PID —";
  updateTerminalControls();
}

function connect() {
  clearTimeout(reconnectTimer);
  const previousSocket = socket;
  socket = null;
  if (previousSocket) previousSocket.close(1000, "Reconnecting");

  if (!config.token) {
    setConnection("offline", "需要令牌");
    elements.dialog.showModal();
    return;
  }

  let url;
  try {
    url = new URL(config.url);
    if (url.protocol !== "ws:" && url.protocol !== "wss:") {
      throw new Error("桥接地址必须使用 ws:// 或 wss://");
    }
    url.searchParams.set("token", config.token);
  } catch (error) {
    setConnection("offline", "地址无效");
    showError(error.message === "桥接地址必须使用 ws:// 或 wss://" ? error.message : "桥接地址无效，请在设置中检查地址");
    return;
  }

  setConnection("connecting", "连接中");
  let nextSocket;
  try {
    nextSocket = new WebSocket(url);
  } catch (error) {
    setConnection("offline", "连接失败");
    showError(`无法创建连接：${error.message}`);
    return;
  }
  socket = nextSocket;

  nextSocket.addEventListener("open", () => {
    if (socket !== nextSocket) return;
    setConnection("online", "已连接");
    fitAddon.fit();
    send({ type: "terminal.resize", cols: terminal.cols, rows: terminal.rows });
  });

  nextSocket.addEventListener("message", (event) => {
    if (socket !== nextSocket) return;
    try {
      handleMessage(JSON.parse(event.data));
    } catch {
      showError("本地桥接程序返回了无法解析的消息");
    }
  });

  nextSocket.addEventListener("close", (event) => {
    if (socket !== nextSocket) return;
    socket = null;
    setConnection("offline", event.code === 1006 ? "连接被拒绝" : "已断开");
    setTerminalActive(false);
    if (aiBusy) showError("连接已中断，Claude Code 任务已停止");
    setAiBusy(false);
    if (event.code !== 1000 && event.code !== 1008) {
      reconnectTimer = setTimeout(connect, 2_500);
    }
  });

  nextSocket.addEventListener("error", () => {
    if (socket !== nextSocket) return;
    setConnection("offline", "连接失败");
  });
}

function handleMessage(message) {
  switch (message.type) {
    case "bridge.ready":
      elements.workspace.textContent = message.workspace;
      elements.workspace.title = message.workspace;
      break;
    case "terminal.started":
      setTerminalActive(true);
      elements.terminalPid.textContent = `PID ${message.pid}`;
      terminal.clear();
      if (focusTerminalOnStart) terminal.focus();
      focusTerminalOnStart = false;
      send({ type: "terminal.resize", cols: terminal.cols, rows: terminal.rows });
      break;
    case "terminal.output":
      terminal.write(message.data);
      break;
    case "terminal.exit":
      setTerminalActive(false);
      terminal.writeln(`\r\n\x1b[31m[Shell 已退出：${message.exitCode}，点击“重启”可重新创建]\x1b[0m`);
      break;
    case "terminal.closed":
      setTerminalActive(false);
      terminal.writeln("\r\n\x1b[38;2;242;173;75m[终端已关闭，点击“新建”可创建新终端]\x1b[0m");
      break;
    case "ai.status":
      setAiBusy(message.state === "thinking");
      break;
    case "ai.delta":
      ensureAssistantMessage().textContent += message.text;
      scrollConversation();
      break;
    case "ai.tool":
      addToolEvent(message.summary);
      break;
    case "ai.result":
      if (message.text && !activeAssistantBody?.textContent.trim()) {
        ensureAssistantMessage().textContent = message.text;
      }
      activeAssistantBody = null;
      break;
    case "ai.error":
    case "bridge.error":
      showError(message.message);
      break;
  }
}

function removeEmptyState() {
  elements.emptyState?.remove();
}

function addMessage(role, text = "") {
  removeEmptyState();
  const message = document.createElement("article");
  message.className = `message ${role}`;
  const label = document.createElement("div");
  label.className = "message-label";
  label.textContent = role === "user" ? "YOU" : "CLAUDE CODE";
  const body = document.createElement("div");
  body.className = "message-body";
  body.textContent = text;
  message.append(label, body);
  elements.conversation.append(message);
  scrollConversation();
  return body;
}

function ensureAssistantMessage() {
  if (!activeAssistantBody) activeAssistantBody = addMessage("assistant");
  return activeAssistantBody;
}

function addToolEvent(summary) {
  const body = ensureAssistantMessage();
  const event = document.createElement("div");
  event.className = "tool-event";
  event.textContent = summary;
  body.parentElement.append(event);
  scrollConversation();
}

function showError(message) {
  removeEmptyState();
  const error = document.createElement("div");
  error.className = "error-event";
  error.textContent = message;
  elements.conversation.append(error);
  scrollConversation();
}

function scrollConversation() {
  requestAnimationFrame(() => {
    elements.conversation.scrollTop = elements.conversation.scrollHeight;
  });
}

function setAiBusy(busy) {
  aiBusy = busy;
  elements.aiStatus.classList.toggle("is-thinking", busy);
  elements.aiStatus.lastChild.textContent = busy ? "运行中" : "空闲";
  elements.sendButton.disabled = busy;
  elements.stopButton.hidden = !busy;
  if (!busy) activeAssistantBody = null;
}

function submitPrompt(prompt) {
  const clean = prompt.trim();
  if (!clean || aiBusy) return;
  if (!send({ type: "ai.ask", prompt: clean })) {
    showError("尚未连接本地桥接程序。请打开右上角设置并填写连接令牌。");
    return;
  }
  activeAssistantBody = null;
  addMessage("user", clean);
  elements.promptInput.value = "";
  setAiBusy(true);
}

terminal.onData((data) => {
  if (terminalActive) send({ type: "terminal.input", data });
});

const resizeObserver = new ResizeObserver(() => {
  fitAddon.fit();
  send({ type: "terminal.resize", cols: terminal.cols, rows: terminal.rows });
});
resizeObserver.observe(document.querySelector(".terminal-frame"));

elements.newTerminal.addEventListener("click", () => {
  focusTerminalOnStart = true;
  if (!send({ type: "terminal.new" })) focusTerminalOnStart = false;
});
elements.restartTerminal.addEventListener("click", () => {
  focusTerminalOnStart = true;
  if (!send({ type: "terminal.restart" })) focusTerminalOnStart = false;
});
elements.closeTerminal.addEventListener("click", () => send({ type: "terminal.close" }));
elements.clear.addEventListener("click", () => terminal.clear());
function openSettings() {
  elements.bridgeUrl.value = config.url;
  elements.bridgeToken.value = config.token;
  elements.dialog.showModal();
}
function closeSettings() {
  elements.dialog.close();
  elements.bridgeUrl.value = config.url;
  elements.bridgeToken.value = config.token;
}
elements.settingsButton.addEventListener("click", openSettings);
elements.settingsCloseButton.addEventListener("click", closeSettings);
elements.settingsCancelButton.addEventListener("click", closeSettings);
elements.bridgeUrl.addEventListener("input", () => elements.bridgeUrl.setCustomValidity(""));
elements.promptForm.addEventListener("submit", (event) => {
  event.preventDefault();
  submitPrompt(elements.promptInput.value);
});
elements.promptInput.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
    event.preventDefault();
    submitPrompt(elements.promptInput.value);
  }
});
elements.stopButton.addEventListener("click", () => send({ type: "ai.stop" }));
document.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    terminal.clear();
  }
});
document.querySelectorAll("[data-prompt]").forEach((button) => {
  button.addEventListener("click", () => submitPrompt(button.dataset.prompt));
});

elements.settingsForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const nextConfig = {
    url: elements.bridgeUrl.value.trim().replace(/\/$/, ""),
    token: elements.bridgeToken.value.trim(),
  };

  try {
    const url = new URL(nextConfig.url);
    if (url.protocol !== "ws:" && url.protocol !== "wss:") {
      throw new Error("桥接地址必须使用 ws:// 或 wss://");
    }
    elements.bridgeUrl.setCustomValidity("");
  } catch (error) {
    elements.bridgeUrl.setCustomValidity(
      error.message === "桥接地址必须使用 ws:// 或 wss://"
        ? error.message
        : "请输入有效的 WebSocket 地址",
    );
    elements.bridgeUrl.reportValidity();
    return;
  }

  config = nextConfig;
  await extensionStorage.set({ bridgeConfig: config });
  elements.dialog.close();
  connect();
});

extensionStorage.get("bridgeConfig").then(({ bridgeConfig }) => {
  if (bridgeConfig) config = { ...config, ...bridgeConfig };
  elements.bridgeUrl.value = config.url;
  elements.bridgeToken.value = config.token;
  updateTerminalControls();
  connect();
});
