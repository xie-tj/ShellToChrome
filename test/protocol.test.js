import test from "node:test";
import assert from "node:assert/strict";
import { isAllowedOrigin, parseClientMessage, sanitizeDimensions } from "../bridge/protocol.js";

test("只允许 Chrome 扩展和回环网页来源", () => {
  assert.equal(isAllowedOrigin("chrome-extension://abcdefghijklmnop"), true);
  assert.equal(isAllowedOrigin("http://127.0.0.1:43110"), true);
  assert.equal(isAllowedOrigin("http://localhost:3000"), true);
  assert.equal(isAllowedOrigin("https://evil.example"), false);
  assert.equal(isAllowedOrigin(undefined), false);
});

test("解析客户端 JSON 消息", () => {
  assert.deepEqual(parseClientMessage('{"type":"ping"}'), {
    ok: true,
    value: { type: "ping" },
  });
  assert.equal(parseClientMessage("not-json").ok, false);
  assert.equal(parseClientMessage("{}").ok, false);
});

test("终端尺寸被限制到安全范围", () => {
  assert.deepEqual(sanitizeDimensions(2, 999), { cols: 20, rows: 200 });
  assert.deepEqual(sanitizeDimensions(120, 40), { cols: 120, rows: 40 });
  assert.deepEqual(sanitizeDimensions(NaN, undefined), { cols: 80, rows: 24 });
});
