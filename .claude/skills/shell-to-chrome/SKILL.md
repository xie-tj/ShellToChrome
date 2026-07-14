---
name: shell-to-chrome
description: Start and operate the local Shell to Chrome bridge so an AI can open a managed browser terminal, send commands, inspect output, restart or close the PTY, use the Claude Code panel, or log in to an SSH host. Use when asked to control a terminal through Chrome, launch the Shell to Chrome cockpit, debug through the browser terminal, connect to an SSH server, or verify the extension end to end. Ensure ordinary ssh commands typed by the user or agent inside the managed terminal are restricted to publickey and gssapi-with-mic.
allowed-tools: Read Bash(${CLAUDE_SKILL_DIR}/scripts/bridge.sh *) Bash(${CLAUDE_SKILL_DIR}/scripts/ssh-connect.sh *)
---

# Shell to Chrome operator

Use the Shell to Chrome project to operate a real local PTY from its loopback web cockpit. Treat `$ARGUMENTS` as the user's requested task. If it is empty, launch or inspect the cockpit and report its state. Prefer local web mode; use the unpacked extension only when the user explicitly asks to test or install it.

## Safety and scope

- Operate only the local machine and workspace the user authorized.
- Do not run destructive, credential, persistence, publication, or irreversible commands unless the user explicitly authorized that exact action.
- Never print or persist the bridge token beyond what is required to connect the local extension.
- The bridge listens only on loopback. Do not expose it on a public interface.
- Do not claim control of an existing Terminal.app, SSH, Kubernetes, or tmux session. This project creates a new managed PTY unless a separate shared-session adapter has been configured.

## SSH authentication policy

When logging in to an SSH host from the cockpit:

1. Treat a Bridge as SSH-policy capable only when `/health` reports `sshAuthenticationMethods` exactly containing `publickey` and `gssapi-with-mic`. A Bridge without that field is outdated and must not be handed off for SSH use.
2. In the managed PTY, verify `command -v ssh` resolves to `<project-root>/bin/ssh`. If it does not, restart the Bridge and create a new PTY before connecting.
3. Let the user or agent type the ordinary command `ssh destination`. It automatically tries only `publickey,gssapi-with-mic`. Use `ssh --auth publickey destination` or `ssh --auth gssapi-with-mic destination` only when an exact allowed method is requested.
4. Do not use `/usr/bin/ssh`, another absolute SSH path, `sshpass`, `expect`, or a different SSH client. Do not alter `PATH` to bypass `<project-root>/bin/ssh`.
5. The managed wrapper disables password, keyboard-interactive/challenge-response, and host-based authentication, sets password prompts to zero, and disables multiplexed-session reuse. User SSH configuration and later command-line `-o` options must not weaken these settings.
6. For `publickey`, use an existing authorized key from the user's SSH configuration, agent, or an explicitly supplied identity file. Never generate, install, copy, or replace a key unless separately authorized.
7. For `gssapi-with-mic`, use an existing Kerberos ticket. If a ticket is missing or expired, tell the user to obtain or renew it locally; never collect a Kerberos password in chat.
8. If both allowed methods fail, stop and report the authentication failure. Never fall back to password or keyboard-interactive prompts.
9. Verify the effective policy without connecting by running `ssh -G example.invalid`. When proof of a live negotiated method is required, use `ssh -v` and confirm OpenSSH reports `publickey` or `gssapi-with-mic` without exposing sensitive verbose details.

## Procedure

1. Resolve the project root as `${CLAUDE_SKILL_DIR}/../../..`.
2. Read `README.md` when setup, environment variables, or extension loading details are needed.
3. Check bridge health:

   ```bash
   ${CLAUDE_SKILL_DIR}/scripts/bridge.sh status
   ```

4. If dependencies or extension vendor files are missing, prepare them:

   ```bash
   ${CLAUDE_SKILL_DIR}/scripts/bridge.sh install
   ```

5. If the bridge is not running, launch it as a background task so its startup output remains available:

   ```bash
   ${CLAUDE_SKILL_DIR}/scripts/bridge.sh start
   ```

   Read the startup output and capture the local WebSocket address and generated token. Keep the task running while operating the extension.

6. If the cockpit server is not running, launch `${CLAUDE_SKILL_DIR}/scripts/bridge.sh serve` as a separate background task, then open `http://127.0.0.1:43112/index.html`. Use the unpacked extension only when explicitly requested; loading it changes a browser profile.
7. In the cockpit settings, enter the bridge URL and token. Prefer filling both fields in one form operation. Save and wait for both:
   - connection state `已连接`;
   - a terminal PID rather than `PID —`.
8. Operate the terminal through the xterm textbox:
   - click/focus the terminal;
   - type the command exactly once and press Enter;
   - wait for a distinctive expected result or prompt;
   - inspect the visible output before claiming success.
9. Use the lifecycle controls only as intended:
   - **新建** replaces the current shell with a new login shell;
   - **重启** recreates it while preserving terminal dimensions;
   - **关闭** stops only the PTY and leaves the bridge/AI connection alive;
   - **清屏** clears browser display only.
10. For a Claude Code task, fill the right-side prompt and submit it. Wait for the AI state to return to `空闲`; report tool actions and final text. Do not equate this panel with direct browser clicking unless Chrome-control tooling is separately enabled.
11. Check browser console errors after a failed connection or interaction. Distinguish extension/CSP failures from bridge/PTTY failures.
12. Run project tests after changing implementation:

   ```bash
   ${CLAUDE_SKILL_DIR}/scripts/bridge.sh test
   ```

13. Stop only bridge or test-browser processes started during this invocation. Do not stop a pre-existing user process.

## Verification standard

Launching is not enough. A successful terminal verification must show all of the following:

1. the actual cockpit page loaded from a loopback `http://127.0.0.1:<port>` origin (or a `chrome-extension://` origin when extension verification was explicitly requested);
2. status is `已连接`;
3. an automatically created PTY PID is visible;
4. a representative command was entered through xterm;
5. its independent output line—not merely shell command echo—was observed;
6. relevant console errors were checked.

When lifecycle behavior is part of the request, additionally verify a new PID after **重启** and `PID —` after **关闭**.

For an SSH-capable handoff, additionally require `/health` to advertise the two allowed methods, verify `command -v ssh` points to `<project-root>/bin/ssh`, and confirm `ssh -G example.invalid` keeps password-style authentication disabled.

## Response

Report concisely:

- bridge and extension state;
- workspace path;
- terminal PID or lifecycle transition;
- command/task executed and observed output;
- for SSH tasks, the negotiated allowed authentication method or the no-fallback failure;
- any skipped step or limitation;
- whether processes started by this invocation remain running.
