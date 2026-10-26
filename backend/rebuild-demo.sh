#!/usr/bin/env bash
# Rebuild ONLY wealthos_demo. The real and test databases are never targets.
set -euo pipefail
cd "$(dirname "$0")"
[ "${WEALTHOS_DEMO_REBUILD:-}" = "wealthos_demo" ] || { echo "Set WEALTHOS_DEMO_REBUILD=wealthos_demo to confirm rebuilding the demo." >&2; exit 2; }
[ -f .env ] || { echo "Run bash scripts/setup.sh first." >&2; exit 1; }
env_value() { sed -n "s/^$1=//p" .env | head -1; }
DB_LOCAL_HOST="$(env_value DB_LOCAL_HOST)"
DB_LOCAL_PORT="$(env_value DB_LOCAL_PORT)"
DB_MIGRATION_USER="$(env_value DB_MIGRATION_USER)"
DB_MIGRATION_PASSWORD="$(env_value DB_MIGRATION_PASSWORD)"
DB_LOCAL_USER="$(env_value DB_LOCAL_USER)"
DB_LOCAL_PASSWORD="$(env_value DB_LOCAL_PASSWORD)"
export DB_LOCAL_HOST DB_LOCAL_PORT DB_MIGRATION_USER DB_MIGRATION_PASSWORD DB_LOCAL_USER DB_LOCAL_PASSWORD
: "${DB_MIGRATION_PASSWORD:?Local migration configuration is missing}"
export DB_LOCAL_NAME=wealthos_demo
export WEALTHOS_DEMO_IMPORT_CONFIRM=wealthos_demo
export PGPASSWORD="$DB_MIGRATION_PASSWORD"
psql "host=$DB_LOCAL_HOST port=$DB_LOCAL_PORT dbname=postgres user=$DB_MIGRATION_USER sslmode=disable" -v ON_ERROR_STOP=1 -Xc "DROP DATABASE IF EXISTS wealthos_demo WITH (FORCE);" -c "CREATE DATABASE wealthos_demo;"
unset PGPASSWORD
pnpm exec tsx src/database/migrate-cli.ts up
pnpm exec tsx src/scripts/import-fixtures.ts chen
pnpm exec tsx src/scripts/import-fixtures.ts me
echo "Synthetic demo is ready in wealthos_demo."
echo "Start it explicitly: DB_LOCAL_NAME=wealthos_demo WEALTHOS_DEMO_PERSONA=chen bash scripts/start.sh"
