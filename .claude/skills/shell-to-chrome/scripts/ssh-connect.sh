#!/usr/bin/env bash
set -euo pipefail

project_root="${SHELL_TO_CHROME_HOME:-/Users/user/Documents/plugin/shellTochrome}"
policy_ssh="$project_root/bin/ssh"
if [[ ! -x "$policy_ssh" ]]; then
  printf 'ShellToChrome SSH policy wrapper not found: %s\n' "$policy_ssh" >&2
  printf 'Set SHELL_TO_CHROME_HOME to the project directory.\n' >&2
  exit 1
fi

exec "$policy_ssh" "$@"
