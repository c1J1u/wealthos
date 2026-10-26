#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
RUN_ID="${WEALTHOS_RUN_ID:-$(printf '%s' "${WEALTHOS_STATIC_DIR:-frontend/dist}" | tr '/' '-')}"
PID_FILE=".run/wealthos-${RUN_ID}.pid"
if [ ! -f "$PID_FILE" ]; then echo "No project background PID file; nothing was stopped."; exit 0; fi
PID="$(cat "$PID_FILE")"
if [[ "$PID" =~ ^[0-9]+$ ]] && kill -0 "$PID" 2>/dev/null; then
  COMMAND="$(ps -p "$PID" -o command= || true)"
  if [[ "$COMMAND" != *"node backend/dist/server.js"* ]]; then
    echo "PID file does not identify this project's app; refusing to stop an unrelated process." >&2
    exit 1
  fi
  kill -TERM -- "-$PID" 2>/dev/null || kill -TERM "$PID"
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    kill -0 "$PID" 2>/dev/null || break
    sleep 0.2
  done
  if kill -0 "$PID" 2>/dev/null; then echo "Project service did not stop cleanly; inspect its PID before retrying." >&2; exit 1; fi
  echo "Stopped the project background service."
else
  echo "The project background service is not running."
fi
RUN_ID="$RUN_ID" python3 -c 'import os; from pathlib import Path; Path(".run/wealthos-" + os.environ["RUN_ID"] + ".pid").unlink(missing_ok=True)'
