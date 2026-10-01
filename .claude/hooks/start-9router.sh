#!/bin/bash
# Start 9router in the background at the start of Claude Code cloud sessions.
set -u

# Only run in remote (cloud) sessions, not on local machines.
[ "${CLAUDE_CODE_REMOTE:-}" = "true" ] || exit 0

# Already running: nothing to do.
curl -s -o /dev/null --max-time 2 http://127.0.0.1:20128/ && exit 0

# Install if the environment's setup script didn't.
if ! command -v 9router >/dev/null 2>&1; then
  npm install -g 9router >/dev/null 2>&1 || { echo "9router: install failed" >&2; exit 0; }
fi

# Detach so the hook returns immediately.
nohup setsid 9router --host 127.0.0.1 --no-browser --skip-update \
  >/tmp/9router.log 2>&1 </dev/null &

echo "9router starting at http://127.0.0.1:20128 (log: /tmp/9router.log)"
exit 0
