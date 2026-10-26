#!/usr/bin/env bash
# Serve the built frontend and API from one loopback-only local service.
set -euo pipefail
cd "$(dirname "$0")/.."
STATIC_DIR="${WEALTHOS_STATIC_DIR:-frontend/dist}"
STATIC_ABS="$PWD/$STATIC_DIR"
RUN_ID="${WEALTHOS_RUN_ID:-$(printf '%s' "$STATIC_DIR" | tr '/' '-')}"
PID_FILE=".run/wealthos-${RUN_ID}.pid"
[ -f backend/.env ] || { echo "Run bash scripts/setup.sh and pnpm bootstrap first." >&2; exit 1; }
PORT_VALUE="${PORT:-$(sed -n 's/^PORT=//p' backend/.env | tail -1)}"
PORT_VALUE="${PORT_VALUE:-8787}"
BASE_URL="http://127.0.0.1:$PORT_VALUE"

if [ ! -d node_modules ] || [ ! -d backend/node_modules ]; then pnpm install --frozen-lockfile; fi
if [ ! -f "$STATIC_DIR/index.html" ]; then pnpm -C frontend build; fi
pnpm -C backend build
pnpm -C backend migrate

if [ "${1:-}" = "--background" ]; then
  mkdir -p .run
  if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
    echo "This WealthOS instance is already running with its project PID file." >&2
    exit 1
  fi
  WEALTHOS_STATIC_DIR="$STATIC_ABS" WEALTHOS_PID_FILE="$PID_FILE" node --input-type=module -e 'import { spawn } from "node:child_process"; import { openSync, writeFileSync } from "node:fs"; const log = openSync(".run/wealthos.log", "a"); const child = spawn(process.execPath, ["backend/dist/server.js"], { detached: true, stdio: ["ignore", log, log], env: process.env }); writeFileSync(process.env.WEALTHOS_PID_FILE, String(child.pid)); child.unref();'
  sleep 3
  CHILD_PID="$(cat "$PID_FILE")"
  if ! kill -0 "$CHILD_PID" 2>/dev/null; then
    echo "The new WealthOS process exited. Check the private run log and whether the selected port is already in use." >&2
    exit 1
  fi
  if curl -fsS "$BASE_URL/health" >/dev/null; then
    echo "WealthOS: $BASE_URL"
    echo "Stop this instance: WEALTHOS_RUN_ID=$RUN_ID bash scripts/stop.sh"
  else
    echo "Health check is not green. Inspect the private .run/wealthos.log without sharing credentials." >&2
    exit 1
  fi
else
  WEALTHOS_STATIC_DIR="$STATIC_ABS" exec node backend/dist/server.js
fi
