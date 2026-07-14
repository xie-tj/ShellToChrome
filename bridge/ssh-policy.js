import fs from "node:fs";
import path from "node:path";

export const ALLOWED_SSH_AUTHENTICATIONS = Object.freeze(["publickey", "gssapi-with-mic"]);

function getPathKey(env) {
  return Object.keys(env).find((key) => key.toLowerCase() === "path") || "PATH";
}

function isSamePath(left, right, platform) {
  return platform === "win32" ? left.toLowerCase() === right.toLowerCase() : left === right;
}

function defaultExecutableCheck(candidate, platform) {
  try {
    fs.accessSync(candidate, platform === "win32" ? fs.constants.F_OK : fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export function resolveNativeSsh({
  env,
  platform,
  wrapperDir,
  executableCheck = defaultExecutableCheck,
}) {
  const pathApi = platform === "win32" ? path.win32 : path;
  const delimiter = platform === "win32" ? ";" : path.delimiter;
  const pathKey = getPathKey(env);
  const normalizedWrapperDir = pathApi.resolve(wrapperDir);
  const trustedCandidates =
    platform === "win32"
      ? [pathApi.join(env.SystemRoot || "C:\\Windows", "System32", "OpenSSH", "ssh.exe")]
      : ["/usr/bin/ssh", "/bin/ssh"];

  for (const candidate of trustedCandidates) {
    if (executableCheck(candidate, platform)) return candidate;
  }

  const extensions =
    platform === "win32"
      ? String(env.PATHEXT || ".COM;.EXE;.BAT;.CMD")
          .split(";")
          .filter(Boolean)
      : [""];

  for (const directory of String(env[pathKey] || "").split(delimiter)) {
    if (!directory) continue;
    const normalizedDirectory = pathApi.resolve(directory);
    if (isSamePath(normalizedDirectory, normalizedWrapperDir, platform)) continue;

    for (const extension of extensions) {
      const candidate = pathApi.join(directory, `ssh${extension}`);
      if (executableCheck(candidate, platform)) return candidate;
    }
  }

  return null;
}

export function createSshPolicyEnvironment({
  env = process.env,
  platform = process.platform,
  shell = env.SHELL || "",
  projectRoot,
  executableCheck = defaultExecutableCheck,
  fileExists = fs.existsSync,
}) {
  if (!projectRoot) throw new Error("SSH policy requires the ShellToChrome project root");

  const pathApi = platform === "win32" ? path.win32 : path;
  const delimiter = platform === "win32" ? ";" : path.delimiter;
  const pathKey = getPathKey(env);
  const wrapperDir = pathApi.join(projectRoot, "bin");
  const wrapperFile = pathApi.join(wrapperDir, platform === "win32" ? "ssh.cmd" : "ssh");
  if (!executableCheck(wrapperFile, platform)) {
    throw new Error(`SSH policy wrapper is unavailable: ${wrapperFile}`);
  }

  const realSsh = resolveNativeSsh({ env, platform, wrapperDir, executableCheck });
  if (!realSsh) throw new Error("Native OpenSSH client not found; refusing an unrestricted terminal");

  const normalizedWrapperDir = pathApi.resolve(wrapperDir);
  const originalPathEntries = String(env[pathKey] || "")
    .split(delimiter)
    .filter(Boolean)
    .filter((entry) => !isSamePath(pathApi.resolve(entry), normalizedWrapperDir, platform));
  const policyEnvironment = {
    ...env,
    [pathKey]: [wrapperDir, ...originalPathEntries].join(delimiter),
    SHELL_TO_CHROME_REAL_SSH: realSsh,
    SHELL_TO_CHROME_SSH_WRAPPER_DIR: wrapperDir,
  };

  if (platform !== "win32" && path.basename(shell) === "zsh") {
    const zshPolicyDir = path.join(projectRoot, "bridge", "zsh-policy");
    if (!fileExists(path.join(zshPolicyDir, ".zshenv"))) {
      throw new Error(`zsh SSH policy startup files are unavailable: ${zshPolicyDir}`);
    }
    policyEnvironment.SHELL_TO_CHROME_ORIGINAL_ZDOTDIR = env.ZDOTDIR || env.HOME || "";
    policyEnvironment.SHELL_TO_CHROME_ZSH_POLICY_DIR = zshPolicyDir;
    policyEnvironment.ZDOTDIR = zshPolicyDir;
  } else if (platform !== "win32" && path.basename(shell) === "bash") {
    const bashPolicyFile = path.join(projectRoot, "bridge", "bash-policy", "bashrc");
    if (!fileExists(bashPolicyFile)) {
      throw new Error(`bash SSH policy startup file is unavailable: ${bashPolicyFile}`);
    }
    policyEnvironment.SHELL_TO_CHROME_BASH_RCFILE = bashPolicyFile;
  }

  return policyEnvironment;
}
