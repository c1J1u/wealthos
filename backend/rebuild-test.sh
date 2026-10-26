#!/usr/bin/env bash
# Rebuild the dedicated WRITE-TEST database and optionally serve it on a
# separate port for frontend command e2e. The demo/real books are never
# touched. Usage:
#   bash backend/rebuild-test.sh          # rebuild wealthos_test only
#   bash backend/rebuild-test.sh --serve  # rebuild + serve on :8788
set -euo pipefail
cd "$(dirname "$0")"

[ "${WEALTHOS_TEST_DB_CONFIRM:-}" = "wealthos_test" ] || { echo "Set WEALTHOS_TEST_DB_CONFIRM=wealthos_test to confirm rebuilding the disposable test database." >&2; exit 2; }
echo "== rebuilding wealthos_test (write sandbox) =="
npx tsx - <<'EOF'
import { rebuildTestDb } from "./tests/write-db.js";
const db = await rebuildTestDb();
console.log(`wealthos_test ready (${db.dbName})`);
await db.close();
EOF

if [[ "${1:-}" == "--serve" ]]; then
  echo "== serving wealthos_test on http://127.0.0.1:8788 =="
  echo "   (chen book, write commands enabled; disposable — rebuild anytime)"
  DB_LOCAL_NAME=wealthos_test WEALTHOS_DEMO_PERSONA=chen PORT=8788 exec npx tsx src/server.ts
fi
