#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
DATA_DIR="${WEALTHOS_PGDATA:-$PWD/.data/postgres}"
if [ -n "${PG_BIN:-}" ]; then
  export PATH="$PG_BIN:$PATH"
elif command -v pg_config >/dev/null; then
  export PATH="$(pg_config --bindir):$PATH"
elif command -v brew >/dev/null && brew --prefix postgresql@17 >/dev/null 2>&1; then
  export PATH="$(brew --prefix postgresql@17)/bin:$PATH"
elif [ -d /usr/lib/postgresql/17/bin ]; then
  export PATH="/usr/lib/postgresql/17/bin:$PATH"
fi

case "${1:-}" in
  start)
    if [ ! -f "$DATA_DIR/PG_VERSION" ]; then
      echo "No local data directory. Run bash scripts/setup.sh first." >&2
      exit 1
    fi
    PORT="${DB_PORT:-5433}"
    if pg_ctl -D "$DATA_DIR" status >/dev/null 2>&1; then
      echo "Local PostgreSQL is already running."
      exit 0
    fi
    if command -v lsof >/dev/null && lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
      echo "TCP port $PORT is already in use; choose a free DB_PORT before starting the managed database." >&2
      exit 1
    fi
    exec pg_ctl -D "$DATA_DIR" -l "$DATA_DIR/server.log" -o "-h 127.0.0.1 -p $PORT" start
    ;;
  stop)
    if [ -f "$DATA_DIR/PG_VERSION" ]; then pg_ctl -D "$DATA_DIR" stop -m fast; else echo "Local database is not initialized."; fi
    ;;
  status)
    if [ -f "$DATA_DIR/PG_VERSION" ]; then pg_ctl -D "$DATA_DIR" status; else echo "Local database is not initialized."; fi
    ;;
  *) echo "Usage: bash scripts/db.sh start|stop|status" >&2; exit 2 ;;
esac
