import { cp, mkdir } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const vendor = path.join(root, "extension", "vendor");
await mkdir(vendor, { recursive: true });

const files = [
  ["node_modules/@xterm/xterm/css/xterm.css", "xterm.css"],
  ["node_modules/@xterm/xterm/lib/xterm.js", "xterm.js"],
  ["node_modules/@xterm/addon-fit/lib/addon-fit.js", "xterm-addon-fit.js"],
];

for (const [source, destination] of files) {
  await cp(path.join(root, source), path.join(vendor, destination));
}

console.log("已把 xterm 浏览器文件复制到 extension/vendor");
