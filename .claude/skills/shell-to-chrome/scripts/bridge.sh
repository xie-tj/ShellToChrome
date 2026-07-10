#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "$0")/../../../.." && pwd)"
bridge_port="${SHELL_TO_CHROME_PORT:-43110}"
web_port="${SHELL_TO_CHROME_WEB_PORT:-43112}"
command="${1:-status}"

case "$command" in
  install)
    cd "$project_root"
    npm install
    npm run prepare:extension
    python3 scripts/generate-icons.py
    ;;
  start)
    cd "$project_root"
    exec npm start
    ;;
  serve)
    printf 'Cockpit: http://127.0.0.1:%s/index.html\n' "$web_port"
    exec python3 -m http.server "$web_port" --bind 127.0.0.1 --directory "$project_root/extension"
    ;;
  local-status)
    curl --fail --silent --show-error "http://127.0.0.1:${bridge_port}/health"
    printf '\n'
    curl --fail --silent --show-error --output /dev/null "http://127.0.0.1:${web_port}/index.html"
    printf 'Cockpit: http://127.0.0.1:%s/index.html\n' "$web_port"
    ;;
  test)
    cd "$project_root"
    npm test
    ;;
  status)
    curl --fail --silent --show-error "http://127.0.0.1:${bridge_port}/health"
    printf '\n'
    ;;
  *)
    printf '用法: %s {install|start|serve|local-status|test|status}\n' "$0" >&2
    exit 2
    ;;
esac
