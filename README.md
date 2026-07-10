# ShellToChrome

在浏览器里打开一个只运行于本机的调试工作台：左侧是由 `node-pty` 管理的真实 Shell，右侧可调用本机已经登录的 Claude Code CLI 检查、修改并验证项目。

> ShellToChrome 默认提供**本地 Web Cockpit**，无需安装 Chrome 扩展。仓库同时保留 Manifest V3 扩展作为可选入口。

## 功能

- 在 Chrome / Chromium 中操作真实的本地 PTY 终端；
- 创建、重启、关闭终端以及清除浏览器显示；
- 将任务交给本机 Claude Code CLI，并显示文本、工具调用和执行状态；
- 页面断线后自动重连；
- 通过随机令牌、Origin 检查和 loopback 限制保护本地桥接；
- 不需要在页面中保存 Claude API Key。

## 工作原理

```text
浏览器 Cockpit（本地 Web 或 Manifest V3 扩展）
  ├─ xterm.js  ─┐
  └─ AI 面板    ├─ WebSocket + 启动令牌 ─ 本机 Bridge
                │                         ├─ node-pty ─ 登录 Shell
                └─────────────────────────└─ claude -p ─ Claude Code CLI
```

Bridge 默认只监听 `127.0.0.1:43110`。每次启动会生成随机连接令牌，并拒绝：

- 非 loopback 请求；
- 非允许来源的 WebSocket 连接；
- 未携带正确令牌的连接。

## 环境要求

- Node.js 20 或更高版本；
- npm；
- Chrome 或 Chromium；
- macOS 或 Linux；Windows 需要满足 `node-pty` 的本地编译要求；
- 如需右侧 AI 面板：安装并登录 [Claude Code](https://docs.anthropic.com/en/docs/claude-code/overview)，确保终端中可以运行 `claude`。

## 安装

```bash
git clone https://github.com/xie-tj/ShellToChrome.git
cd ShellToChrome
npm install
npm run prepare:extension
```

`npm install` 会安装 Bridge、PTY 和 xterm 依赖；`npm run prepare:extension` 会把 xterm 浏览器文件复制到 `extension/vendor/`。该目录是生成产物，不提交到 Git。

项目图标已经包含在仓库中。如需重新生成图标：

```bash
python3 scripts/generate-icons.py
```

## 推荐用法：本地 Web Cockpit

### 1. 启动 Bridge

在要操作的工作目录中启动 ShellToChrome：

```bash
cd /path/to/your/project
SHELL_TO_CHROME_CWD="$PWD" node /path/to/ShellToChrome/bridge/server.js
```

如果操作 ShellToChrome 仓库自身，也可以在仓库根目录直接运行：

```bash
npm start
```

启动信息类似：

```text
shellToChrome bridge 已启动
WebSocket: ws://127.0.0.1:43110
连接令牌:  <随机令牌>
工作目录:  <工作目录>
```

令牌是本机终端的访问凭据，不要粘贴到聊天、日志或公开 Issue 中。

### 2. 启动 Cockpit 静态服务器

在 ShellToChrome 仓库根目录执行：

```bash
python3 -m http.server 43112 --bind 127.0.0.1 --directory extension
```

浏览器打开：

```text
http://127.0.0.1:43112/index.html
```

### 3. 首次连接

1. 打开右上角的连接设置；
2. Bridge 地址填写 `ws://127.0.0.1:43110`；
3. 填入 Bridge 启动时显示的随机令牌；
4. 点击 **保存并连接**；
5. 确认状态显示 **已连接**、工作目录正确，并且终端标题出现 `PID <数字>`。

本地 Web 模式把配置保存在当前网页 Origin 的 `localStorage`。更换端口或浏览器配置文件后需要重新填写。

### 4. 操作终端

点击左侧终端即可输入命令。标题栏按钮的含义：

| 按钮 | 行为 |
|---|---|
| 新建 | 关闭当前 Shell，创建新的登录 Shell |
| 重启 | 重新创建 Shell，并保留最近的终端尺寸 |
| 关闭 | 仅停止 PTY，页面和 Bridge 连接仍保持 |
| 清屏 | 只清除浏览器中的显示，不影响 Shell 进程 |

这是 Bridge 新建并管理的 PTY，不是对现有 Terminal.app、SSH、tmux 或 Kubernetes 会话的接管。

### 5. 使用 Claude Code 面板

右侧输入任务并点击 **发送任务**。Bridge 会在指定工作目录执行：

```text
claude -p --output-format stream-json --permission-mode auto ...
```

需要先在本机完成 Claude Code 登录。页面不保存 Claude API Key，而是复用 Claude Code CLI 的本地登录状态。

## 可选用法：加载 Chrome 扩展

仅在确实需要扩展入口时使用：

1. 先完成 `npm install` 和 `npm run prepare:extension`；
2. 打开 `chrome://extensions`；
3. 开启 **开发者模式**；
4. 点击 **加载已解压的扩展程序**；
5. 选择仓库中的 `extension/` 目录；
6. 点击工具栏中的 ShellToChrome 图标；
7. 填写 Bridge 地址和启动令牌，然后保存连接。

扩展模式将配置保存在 `chrome.storage.local`。它只申请 `storage` 权限，以及访问本机 `127.0.0.1` HTTP / WebSocket 的 Host 权限。

修改 `extension/` 后，在 `chrome://extensions` 点击扩展的重新加载按钮，再刷新 Cockpit 页面。

## 调试其他项目

`SHELL_TO_CHROME_CWD` 同时决定终端和 Claude Code 的工作目录：

```bash
SHELL_TO_CHROME_CWD=/absolute/path/to/project npm start
```

务必确认页面顶部显示的 `WORKSPACE` 与预期一致。不要把工作目录设为主目录或包含无关敏感数据的目录。

## 环境变量

| 变量 | 默认值 | 说明 |
|---|---|---|
| `SHELL_TO_CHROME_CWD` | 启动 Bridge 时的当前目录 | PTY 和 Claude Code 工作目录 |
| `SHELL_TO_CHROME_PORT` | `43110` | Bridge 的 loopback 端口 |
| `SHELL_TO_CHROME_TOKEN` | 每次启动随机生成 | 指定固定令牌；通常不建议 |
| `SHELL` | 系统默认 Shell | PTY 使用的 Shell |

使用其他 Bridge 端口：

```bash
SHELL_TO_CHROME_PORT=43210 npm start
```

本地 Web 静态服务器没有专用 Node 脚本，可直接选择任意空闲 loopback 端口：

```bash
python3 -m http.server 43212 --bind 127.0.0.1 --directory extension
```

## 安全边界

ShellToChrome **不是安全沙箱**。成功连接页面的人可以操作该 Bridge 创建的本机 Shell；右侧 Claude Code 以 `auto` 权限模式运行，并可在工作目录内使用其可用工具。

建议：

- 仅在可信本机和可信项目中运行；
- Bridge 与 Web 服务都只绑定 `127.0.0.1`，不要改成 `0.0.0.0`；
- 将启动令牌视为临时密码；
- 不要把终端输出、浏览器配置文件或令牌提交到 Git；
- 使用专门的低权限系统账户；
- 对不可信代码使用容器或虚拟机；
- 关闭 Bridge 后，随机令牌自动失效；不再使用页面时可在连接设置中替换或清除保存的配置。

内置提示会阻止未经当前请求授权的破坏性、不可逆、凭据、持久化和外部发布操作，但提示本身不能替代操作系统级隔离。

## 验证

### 自动测试

```bash
npm test
```

测试覆盖：

- Bridge 消息协议和 Origin / loopback 检查；
- PTY 生命周期和终端消息；
- Claude Code stream-json 解析；
- 子进程树终止行为。

### 端到端检查

服务返回 HTTP 200 并不等于 Cockpit 可用。完整验证应确认：

1. 页面通过 `http://127.0.0.1:<port>/index.html` 加载；
2. 状态为 **已连接**；
3. 页面显示的工作目录正确；
4. 自动创建了 PTY PID；
5. 命令是通过 xterm 输入的；
6. 页面显示了独立的命令输出，而不只是命令回显；
7. 浏览器控制台没有鉴权、WebSocket、CSP 或脚本错误。

可使用无副作用的测试命令：

```bash
printf 'SHELL_TO_CHROME_OK:%s\n' "$PWD"
```

## 故障排查

### 页面显示“需要令牌”

当前页面 Origin 或浏览器配置文件中没有连接配置。打开连接设置，重新填写 Bridge 地址和本次启动令牌。

### 页面显示“连接被拒绝”或“连接失败”

检查：

```bash
curl http://127.0.0.1:43110/health
```

然后确认：

- Bridge 正在运行；
- 地址端口与启动输出一致；
- 使用的是本次 Bridge 启动生成的令牌；
- 页面来自 loopback HTTP 或扩展页面；
- 端口没有被其他服务占用。

### 状态已连接，但显示 `PID —`

点击 **新建**。如果仍失败，查看 Bridge 终端中的 `node-pty` 错误，并重新执行：

```bash
npm install
```

### 页面加载但没有样式或终端

确认生成的浏览器依赖存在：

```bash
npm run prepare:extension
ls extension/vendor
```

然后检查浏览器控制台中的脚本、CSP 和静态资源错误。`favicon.ico` 的 404 只影响图标，不影响功能。

### AI 面板提示找不到 `claude`

确认 Claude Code 已安装并登录：

```bash
claude --version
claude
```

交互式登录应直接在本机终端中完成，不要通过聊天发送密码或验证码。

## 开发

```bash
npm install
npm run prepare:extension
npm run dev
npm test
```

目录结构：

```text
bridge/       本机 HTTP/WebSocket Bridge、PTY 和 Claude Code runner
extension/    本地 Web 与 Manifest V3 共用的 Cockpit 前端
test/         Node.js 测试
scripts/      浏览器依赖复制、图标生成和 node-pty 修复脚本
.claude/      项目级 ShellToChrome 操作 Skill
```

## License

目前仓库未声明开源许可证。在添加许可证前，默认保留所有权利。
