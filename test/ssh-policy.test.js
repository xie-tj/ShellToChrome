import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createSshPolicyEnvironment } from "../bridge/ssh-policy.js";

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function parseSshConfig(output) {
  return new Map(
    output
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const separator = line.indexOf(" ");
        return [line.slice(0, separator), line.slice(separator + 1)];
      }),
  );
}

function assertRestrictedConfig(config, { preferred, pubkey, gssapi }) {
  assert.equal(config.get("preferredauthentications"), preferred);
  assert.equal(config.get("pubkeyauthentication"), pubkey);
  assert.equal(config.get("gssapiauthentication"), gssapi);
  assert.equal(config.get("passwordauthentication"), "no");
  assert.equal(config.get("kbdinteractiveauthentication"), "no");
  assert.equal(config.get("hostbasedauthentication"), "no");
  assert.equal(config.get("numberofpasswordprompts"), "0");
  assert.equal(config.get("controlmaster"), "false");
  assert.equal(config.get("controlpersist"), "no");
}

test("PTY 环境把 SSH wrapper 放在 PATH 首位并为 zsh 安装启动策略", () => {
  const executableFiles = new Set(["/project/bin/ssh", "/usr/bin/ssh"]);
  const environment = createSshPolicyEnvironment({
    env: {
      HOME: "/home/test",
      PATH: "/custom/bin:/usr/bin",
      SHELL: "/bin/zsh",
      ZDOTDIR: "/home/test/.config/zsh",
    },
    platform: "darwin",
    shell: "/bin/zsh",
    projectRoot: "/project",
    executableCheck: (candidate) => executableFiles.has(candidate),
    fileExists: (candidate) => candidate === "/project/bridge/zsh-policy/.zshenv",
  });

  assert.equal(environment.PATH, "/project/bin:/custom/bin:/usr/bin");
  assert.equal(environment.SHELL_TO_CHROME_REAL_SSH, "/usr/bin/ssh");
  assert.equal(environment.SHELL_TO_CHROME_SSH_WRAPPER_DIR, "/project/bin");
  assert.equal(environment.SHELL_TO_CHROME_ORIGINAL_ZDOTDIR, "/home/test/.config/zsh");
  assert.equal(environment.ZDOTDIR, "/project/bridge/zsh-policy");
});

test("找不到原生 OpenSSH 时拒绝创建不受限制的终端环境", () => {
  assert.throws(
    () =>
      createSshPolicyEnvironment({
        env: { HOME: "/home/test", PATH: "/missing", SHELL: "/bin/zsh" },
        platform: "darwin",
        shell: "/bin/zsh",
        projectRoot: "/project",
        executableCheck: (candidate) => candidate === "/project/bin/ssh",
        fileExists: () => true,
      }),
    /Native OpenSSH client not found/,
  );
});

test("PTY 环境为 bash 安装受控 rcfile", () => {
  const executableFiles = new Set(["/project/bin/ssh", "/usr/bin/ssh"]);
  const environment = createSshPolicyEnvironment({
    env: { HOME: "/home/test", PATH: "/usr/bin:/bin", SHELL: "/bin/bash" },
    platform: "darwin",
    shell: "/bin/bash",
    projectRoot: "/project",
    executableCheck: (candidate) => executableFiles.has(candidate),
    fileExists: (candidate) => candidate === "/project/bridge/bash-policy/bashrc",
  });

  assert.equal(environment.SHELL_TO_CHROME_BASH_RCFILE, "/project/bridge/bash-policy/bashrc");
});

test("SSH wrapper 只接受 publickey 和 gssapi-with-mic", { skip: process.platform === "win32" }, () => {
  const wrapper = path.join(PROJECT_ROOT, "bin", "ssh");
  const cases = [
    ["auto", "publickey,gssapi-with-mic", "true", "yes"],
    ["publickey", "publickey", "true", "no"],
    ["gssapi-with-mic", "gssapi-with-mic", "false", "yes"],
  ];

  for (const [mode, preferred, pubkey, gssapi] of cases) {
    const output = execFileSync(
      wrapper,
      [
        "--auth",
        mode,
        "-T",
        "-G",
        "-o",
        "PasswordAuthentication=yes",
        "-o",
        "KbdInteractiveAuthentication=yes",
        "-o",
        "PreferredAuthentications=password",
        "example.invalid",
      ],
      { encoding: "utf8" },
    );
    assertRestrictedConfig(parseSshConfig(output), { preferred, pubkey, gssapi });
  }

  const rejected = spawnSync(wrapper, ["--auth", "password", "-T", "-G", "example.invalid"], {
    encoding: "utf8",
  });
  assert.equal(rejected.status, 2);
  assert.match(rejected.stderr, /Allowed methods: publickey, gssapi-with-mic/);
});

test("zsh 登录配置重置 PATH 后，用户输入普通 ssh 仍命中受限 wrapper", {
  skip: process.platform === "win32" || !fs.existsSync("/bin/zsh"),
}, () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "shell-to-chrome-ssh-policy-"));
  try {
    fs.writeFileSync(path.join(home, ".zprofile"), "export PATH=/usr/bin:/bin\n");
    fs.writeFileSync(
      path.join(home, ".zshrc"),
      'export PATH=/usr/bin:/bin\nexport HISTFILE="$ZDOTDIR/.zsh_history"\n',
    );
    const policyHistory = path.join(PROJECT_ROOT, "bridge", "zsh-policy", ".zsh_history");
    const historyBefore = fs.existsSync(policyHistory) ? fs.statSync(policyHistory) : null;
    const environment = createSshPolicyEnvironment({
      env: { ...process.env, HOME: home, PATH: process.env.PATH, SHELL: "/bin/zsh" },
      platform: process.platform,
      shell: "/bin/zsh",
      projectRoot: PROJECT_ROOT,
    });
    const output = execFileSync(
      "/bin/zsh",
      [
        "-lic",
        "command -v ssh; printf '__HISTFILE__%s\\n' \"$HISTFILE\"; ssh -T -G -o PasswordAuthentication=yes -o PreferredAuthentications=password example.invalid 2>/dev/null",
      ],
      { encoding: "utf8", env: environment, stdio: ["ignore", "pipe", "ignore"] },
    );
    const [resolvedSsh, historyFile, ...configLines] = output.trim().split("\n");

    assert.equal(resolvedSsh, path.join(PROJECT_ROOT, "bin", "ssh"));
    assert.equal(historyFile, `__HISTFILE__${path.join(home, ".zsh_history")}`);
    const historyAfter = fs.existsSync(policyHistory) ? fs.statSync(policyHistory) : null;
    assert.equal(historyAfter?.mtimeMs, historyBefore?.mtimeMs);
    assert.equal(historyAfter?.size, historyBefore?.size);
    assertRestrictedConfig(parseSshConfig(configLines.join("\n")), {
      preferred: "publickey,gssapi-with-mic",
      pubkey: "true",
      gssapi: "yes",
    });
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("bash 登录配置重置 PATH 后，用户输入普通 ssh 仍命中受限 wrapper", {
  skip: process.platform === "win32" || !fs.existsSync("/bin/bash"),
}, () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "shell-to-chrome-bash-ssh-policy-"));
  try {
    fs.writeFileSync(path.join(home, ".bash_profile"), "export PATH=/usr/bin:/bin\n");
    const environment = createSshPolicyEnvironment({
      env: { ...process.env, HOME: home, PATH: process.env.PATH, SHELL: "/bin/bash" },
      platform: process.platform,
      shell: "/bin/bash",
      projectRoot: PROJECT_ROOT,
    });
    const output = execFileSync(
      "/bin/bash",
      [
        "--noprofile",
        "--rcfile",
        environment.SHELL_TO_CHROME_BASH_RCFILE,
        "-i",
        "-c",
        "command -v ssh; ssh -T -G -o PasswordAuthentication=yes -o PreferredAuthentications=password example.invalid 2>/dev/null",
      ],
      { encoding: "utf8", env: environment, stdio: ["ignore", "pipe", "ignore"] },
    );
    const [resolvedSsh, ...configLines] = output.trim().split("\n");

    assert.equal(resolvedSsh, path.join(PROJECT_ROOT, "bin", "ssh"));
    assertRestrictedConfig(parseSshConfig(configLines.join("\n")), {
      preferred: "publickey,gssapi-with-mic",
      pubkey: "true",
      gssapi: "yes",
    });
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
