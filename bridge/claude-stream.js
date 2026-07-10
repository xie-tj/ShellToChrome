export function createClaudeStreamParser(onEvent) {
  const decoder = new TextDecoder();
  let buffer = "";

  return {
    push(chunk) {
      buffer += typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) parseLine(line, onEvent);
    },
    end() {
      buffer += decoder.decode();
      if (buffer.trim()) parseLine(buffer, onEvent);
      buffer = "";
    },
  };
}

function parseLine(line, onEvent) {
  if (!line.trim()) return;

  let event;
  try {
    event = JSON.parse(line);
  } catch {
    onEvent({ type: "raw", text: line });
    return;
  }

  if (event.type === "system" && event.subtype === "init" && event.session_id) {
    onEvent({ type: "session", sessionId: event.session_id });
  }

  if (event.type === "assistant" && event.message?.content) {
    for (const block of event.message.content) {
      if (block.type === "text" && block.text) {
        onEvent({ type: "text", text: block.text });
      } else if (block.type === "tool_use") {
        onEvent({
          type: "tool",
          name: block.name ?? "tool",
          summary: summarizeTool(block.name, block.input),
        });
      }
    }
  }

  if (event.type === "result") {
    onEvent({
      type: "result",
      success: !event.is_error,
      text: typeof event.result === "string" ? event.result : "",
      costUsd: event.total_cost_usd,
    });
  }
}

function summarizeTool(name, input = {}) {
  if (name === "Bash") return input.description || input.command || "运行终端命令";
  if (name === "Read") return `读取 ${input.file_path || "文件"}`;
  if (name === "Edit" || name === "Write") return `${name === "Edit" ? "修改" : "写入"} ${input.file_path || "文件"}`;
  return `${name} ${JSON.stringify(input).slice(0, 140)}`;
}
