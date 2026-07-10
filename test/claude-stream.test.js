import test from "node:test";
import assert from "node:assert/strict";
import { createClaudeStreamParser } from "../bridge/claude-stream.js";

test("解析 Claude Code 的流式会话、文本、工具和结果", () => {
  const events = [];
  const parser = createClaudeStreamParser((event) => events.push(event));

  parser.push('{"type":"system","subtype":"init","session_id":"session-1"}\n');
  parser.push('{"type":"assistant","message":{"content":[{"type":"text","text":"正在检查"},{"type":"tool_use","name":"Bash","input":{"description":"运行测试"}}]}}\n');
  parser.push('{"type":"result","is_error":false,"result":"完成","total_cost_usd":0.01}\n');
  parser.end();

  assert.deepEqual(events, [
    { type: "session", sessionId: "session-1" },
    { type: "text", text: "正在检查" },
    { type: "tool", name: "Bash", summary: "运行测试" },
    { type: "result", success: true, text: "完成", costUsd: 0.01 },
  ]);
});

test("并发解析器不会混用跨块 UTF-8 状态", () => {
  const encoder = new TextEncoder();
  const firstEvents = [];
  const secondEvents = [];
  const first = createClaudeStreamParser((event) => firstEvents.push(event));
  const second = createClaudeStreamParser((event) => secondEvents.push(event));
  const firstLine = encoder.encode('{"type":"assistant","message":{"content":[{"type":"text","text":"甲"}]}}\n');
  const secondLine = encoder.encode('{"type":"assistant","message":{"content":[{"type":"text","text":"乙"}]}}\n');
  const splitAt = firstLine.indexOf(0xe7) + 1;

  first.push(firstLine.subarray(0, splitAt));
  second.push(secondLine);
  first.push(firstLine.subarray(splitAt));
  first.end();
  second.end();

  assert.deepEqual(firstEvents, [{ type: "text", text: "甲" }]);
  assert.deepEqual(secondEvents, [{ type: "text", text: "乙" }]);
});

test("支持跨数据块的 JSON 行", () => {
  const events = [];
  const parser = createClaudeStreamParser((event) => events.push(event));
  parser.push('{"type":"assistant","message":{"content":[{"type":"text",');
  parser.push('"text":"分块"}]}}\n');
  parser.end();
  assert.deepEqual(events, [{ type: "text", text: "分块" }]);
});
