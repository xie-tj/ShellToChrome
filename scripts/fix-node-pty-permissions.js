import { chmod } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

if (os.platform() !== "win32") {
  const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const platform = os.platform() === "darwin" ? "darwin" : "linux";
  const arch = os.arch() === "arm64" ? "arm64" : "x64";
  const helper = path.join(
    projectRoot,
    "node_modules",
    "node-pty",
    "prebuilds",
    `${platform}-${arch}`,
    "spawn-helper",
  );

  try {
    await chmod(helper, 0o755);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}
