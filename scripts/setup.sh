#!/usr/bin/env bash
# Prepare local-only dependencies, PostgreSQL roles and two empty databases.
# Existing server: supply WEALTHOS_DB_ADMIN_USER, WEALTHOS_DB_ADMIN_PORT and
# WEALTHOS_DB_ADMIN_PASSWORD through your protected process environment.
set -euo pipefail
cd "$(dirname "$0")/.."
umask 077
command -v node >/dev/null || { echo "Node.js 24+ is required." >&2; exit 1; }
command -v pnpm >/dev/null || { echo "pnpm 10+ is required (run corepack enable)." >&2; exit 1; }
command -v openssl >/dev/null || { echo "openssl is required to generate local credentials." >&2; exit 1; }
command -v psql >/dev/null || { echo "PostgreSQL client tools are required. See README.md." >&2; exit 1; }
pnpm install --frozen-lockfile

DB_HOST=127.0.0.1
DB_PORT="${DB_PORT:-5433}"
if [ -z "${WEALTHOS_DB_ADMIN_USER:-}" ]; then
  if [ -n "${PG_BIN:-}" ]; then
    export PATH="$PG_BIN:$PATH"
  elif command -v pg_config >/dev/null; then
    export PATH="$(pg_config --bindir):$PATH"
  elif command -v brew >/dev/null && brew --prefix postgresql@17 >/dev/null 2>&1; then
    export PATH="$(brew --prefix postgresql@17)/bin:$PATH"
  elif [ -d /usr/lib/postgresql/17/bin ]; then
    export PATH="/usr/lib/postgresql/17/bin:$PATH"
  fi
  command -v initdb >/dev/null || { echo "PostgreSQL 17 server tools are required; set PG_BIN or the existing-server variables in README.md." >&2; exit 1; }
  export PG_BIN="$(dirname "$(command -v initdb)")"
  DATA_DIR="$PWD/.data/postgres"
  if [ -f "$DATA_DIR/PG_VERSION" ]; then
    echo "This checkout already has a managed local database. Use its existing backend/.env, or install from a fresh checkout. No credential was changed." >&2
    exit 1
  fi
  PASSWORD_FILE="$PWD/.data/admin-password"
  if [ ! -f "$DATA_DIR/PG_VERSION" ]; then
    [ ! -e "$DATA_DIR" ] || { echo "$DATA_DIR exists without PG_VERSION; move it aside before retrying." >&2; exit 1; }
    mkdir -p "$PWD/.data"
    OWNER_PASSWORD="$(openssl rand -hex 24)"
    printf '%s\n' "$OWNER_PASSWORD" > "$PASSWORD_FILE"
    initdb -D "$DATA_DIR" -U wealthos_owner --auth-host=scram-sha-256 --auth-local=trust --pwfile="$PASSWORD_FILE" --no-instructions >/dev/null
  fi
  PG_BIN="$PG_BIN" bash scripts/db.sh start
  OWNER_PASSWORD="$(cat "$PASSWORD_FILE")"
  ADMIN_USER=wealthos_owner
else
  ADMIN_USER="$WEALTHOS_DB_ADMIN_USER"
  OWNER_PASSWORD="${WEALTHOS_DB_ADMIN_PASSWORD:-}"
  DB_HOST=127.0.0.1
  DB_PORT="${WEALTHOS_DB_ADMIN_PORT:-5432}"
  [[ "$DB_PORT" =~ ^[0-9]+$ ]] || { echo "WEALTHOS_DB_ADMIN_PORT must be a number." >&2; exit 1; }
  [ -n "$OWNER_PASSWORD" ] || { echo "Set WEALTHOS_DB_ADMIN_PASSWORD in your protected environment." >&2; exit 1; }
fi

APP_PASSWORD="${WEALTHOS_APP_PASSWORD:-$(openssl rand -hex 24)}"
export PGPASSWORD="$OWNER_PASSWORD"
ADMIN_DSN="host=$DB_HOST port=$DB_PORT dbname=postgres user=$ADMIN_USER sslmode=disable"
SERVER_ADDRESS="$(psql "$ADMIN_DSN" -AtXc "SELECT coalesce(host(inet_server_addr()), 'unix-socket')")"
if [ "$SERVER_ADDRESS" != "127.0.0.1" ] && [ "$SERVER_ADDRESS" != "::1" ] && [ "$SERVER_ADDRESS" != "unix-socket" ]; then
  echo "Refusing to initialize a non-loopback PostgreSQL server ($SERVER_ADDRESS)." >&2
  exit 1
fi
if [ "$(psql "$ADMIN_DSN" -AtXc "SELECT count(*) FROM pg_roles WHERE rolname='wealthos_app'")" = "0" ]; then
  psql "$ADMIN_DSN" -v ON_ERROR_STOP=1 -Xc "CREATE ROLE wealthos_app LOGIN PASSWORD '$APP_PASSWORD';"
else
  if [ -z "${WEALTHOS_APP_PASSWORD:-}" ]; then
    echo "wealthos_app already exists. Supply its existing password as WEALTHOS_APP_PASSWORD; setup will not rotate it silently." >&2
    exit 1
  fi
fi
for db in wealthos wealthos_demo; do
  if [ "$(psql "$ADMIN_DSN" -AtXc "SELECT count(*) FROM pg_database WHERE datname='$db'")" = "0" ]; then
    psql "$ADMIN_DSN" -v ON_ERROR_STOP=1 -Xc "CREATE DATABASE $db;"
  fi
  psql "host=$DB_HOST port=$DB_PORT dbname=$db user=$ADMIN_USER sslmode=disable" -v ON_ERROR_STOP=1 -Xc "GRANT CONNECT ON DATABASE $db TO wealthos_app;"
done
unset PGPASSWORD
cat > backend/.env <<ENV
DATABASE_PROFILE=local
DB_LOCAL_HOST=$DB_HOST
DB_LOCAL_PORT=$DB_PORT
DB_LOCAL_NAME=wealthos
DB_LOCAL_USER=wealthos_app
DB_LOCAL_PASSWORD=$APP_PASSWORD
DB_MIGRATION_USER=$ADMIN_USER
DB_MIGRATION_PASSWORD=$OWNER_PASSWORD
HOST=127.0.0.1
PORT=8787
LOG_LEVEL=info
ENV
chmod 600 backend/.env
echo "Local configuration written to backend/.env (ignored by Git)."
echo "Next: pnpm bootstrap && pnpm build && bash scripts/start.sh"
echo "Optional demo: WEALTHOS_DEMO_REBUILD=wealthos_demo bash backend/rebuild-demo.sh"
