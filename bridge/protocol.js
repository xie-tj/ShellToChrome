const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

export function isLoopbackRequest(request) {
  const remote = request.socket?.remoteAddress;
  return remote === "127.0.0.1" || remote === "::1" || remote === "::ffff:127.0.0.1";
}

export function isAllowedOrigin(origin) {
  if (!origin) return false;

  try {
    const url = new URL(origin);
    if (url.protocol === "chrome-extension:") return true;
    return (url.protocol === "http:" || url.protocol === "https:") && LOOPBACK_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}

export function parseClientMessage(raw) {
  let value;
  try {
    value = JSON.parse(raw.toString());
  } catch {
    return { ok: false, error: "消息不是有效 JSON" };
  }

  if (!value || typeof value.type !== "string") {
    return { ok: false, error: "消息缺少 type" };
  }

  return { ok: true, value };
}

export function sanitizeDimensions(cols, rows) {
  const normalizedCols = Number.isFinite(cols) ? Math.trunc(cols) : 80;
  const normalizedRows = Number.isFinite(rows) ? Math.trunc(rows) : 24;
  return {
    cols: Math.max(20, Math.min(500, normalizedCols)),
    rows: Math.max(5, Math.min(200, normalizedRows)),
  };
}
