# WealthOS

Local-first personal finance with double-entry accounting, financial read models, and a responsive Chinese/English web interface. One active local PostgreSQL database, one local service, no hosted account or cloud database required.

**Status:** v0.1, single-user local application. Use your own backups before relying on it for financial records. Synthetic demo data is not real personal data.

## Included

- Overview, transactions, accounts, income, expenses, cash flow, assets, investments, analytics, reports, and settings.
- Integer minor-unit money, double-entry preview, idempotent transaction creation, and reversal rather than deletion.
- Loopback-only web/API hosting, offline static assets, and optional pairing plus CSRF protection.
- Local PostgreSQL schema migrations, row-level book isolation, synthetic demo fixtures, and backend/frontend tests.
- MIT license. Budgets, goals, forecasting, recurring automation, account-management APIs, imports, and banking synchronization are not part of this release.

The empty-book initializer creates one owner, one book, one zero-balance cash account, and income/expense ledger categories. It creates **no transactions**. This release does not provide a general account editor or an opening-balance workflow.

## Requirements

- macOS or Debian/Ubuntu Linux with Bash.
- Node.js 24 or newer, pnpm 10 or newer, PostgreSQL 17 client/server tools, `openssl`, and `curl`.
- Python 3 for the stop helper (standard on macOS; usually already installed on Linux).
- Playwright Chromium only for browser tests; not needed for normal use.

macOS prerequisites, using Homebrew:

```bash
brew install node postgresql@17 pnpm openssl curl python
export PATH="$(brew --prefix postgresql@17)/bin:$PATH"
corepack enable
```

Debian/Ubuntu prerequisites: install Node.js 24+, pnpm, PostgreSQL 17, OpenSSL, curl, and Python 3 with your package manager or the official upstream installers. Ensure `psql`, `initdb`, and `pg_ctl` resolve to the same PostgreSQL major version. If they are not on `PATH`, set `PG_BIN=/path/to/postgresql-17/bin` for setup and database commands.

## Installation for an AI Agent

Work non-interactively, preserve the user's data, and do not print or commit secrets. Run from the repository root after cloning:

```bash
git clone https://github.com/c1J1u/wealthos.git
cd wealthos
node --version
pnpm --version
psql --version
```

Choose **one** database route.

### Route A — managed local PostgreSQL (recommended for a new installation)

This creates `.data/postgres`, listens only on `127.0.0.1:5433`, generates local credentials, and creates empty `wealthos` and `wealthos_demo` databases. It does not manage an existing system PostgreSQL service. Use a fresh checkout; never point this managed setup at an existing data directory.

```bash
bash scripts/setup.sh
```

If `5433` is occupied, stop the conflicting process only after identifying its owner, or use Route B with another port. Do not delete `.data` to resolve a port conflict. For PostgreSQL installed outside `PATH`, use:

```bash
PG_BIN=/path/to/postgresql-17/bin bash scripts/setup.sh
```

### Route B — existing local PostgreSQL

Use a dedicated local administrator connection through an environment variable. Never write it in the repository, a ticket, or a chat log. The target must be loopback; use an SSH tunnel if the administrator connection is remote. Example with a local port:

```bash
export WEALTHOS_DB_ADMIN_USER='ADMIN'
export WEALTHOS_DB_ADMIN_PORT=5432
export WEALTHOS_DB_ADMIN_PASSWORD='LOCAL_ADMIN_PASSWORD'
bash scripts/setup.sh
unset WEALTHOS_DB_ADMIN_USER WEALTHOS_DB_ADMIN_PORT WEALTHOS_DB_ADMIN_PASSWORD
```

The script creates/updates the local `wealthos_app` login and creates empty databases if absent. It checks the server's actual `inet_server_addr()` and refuses a non-loopback server, even through a forwarded connection. It does not erase an existing `wealthos` database. For an existing book, retain its matching `backend/.ledger.json`; the initializer refuses to silently adopt an existing book without that binding. Route B never silently rotates an existing `wealthos_app` password. If that login already exists, provide its current password with `WEALTHOS_APP_PASSWORD`; use this route only on a dedicated local installation, not a shared server.

### Initialize, build, run

After either route:

```bash
pnpm bootstrap
pnpm build
bash scripts/start.sh --background
curl --fail --silent http://127.0.0.1:8787/health
```

Expected health response: `status` is `ok` and `db` is `up`. Open <http://127.0.0.1:8787>. The first page should show the initialized book, one cash account, and zero transactions. The owner decides what, when, and whether to record; the installer must not create a first transaction as a side effect.

Optional custom owner/book names must be supplied on the **first** bootstrap only:

```bash
pnpm -C backend bootstrap -- --display-name 'Owner' --book-name 'My book'
```

`backend/.env` and `backend/.ledger.json` are private, mode-0600 local state. Keep them with the database backup; both are ignored by Git. The setup-managed database password is also in ignored `.data/admin-password`. Do not expose them in issue reports or generated documentation.

## Stop and lifecycle

```bash
bash scripts/stop.sh
bash scripts/db.sh stop
```

To start the setup-managed database again, use `bash scripts/db.sh start`. To restart only the web application, use `bash scripts/start.sh --background`. A foreground alternative is `bash scripts/start.sh`.

The stop helper uses the selected instance's PID file and refuses to kill an unrelated port owner. When `WEALTHOS_STATIC_DIR` is set for start, set the same value for stop. Do not replace it with `killall node`, `pkill postgres`, or broad port-based termination.

## Synthetic demo (optional)

This creates two synthetic personas and 145 synthetic transactions in `wealthos_demo` only. It does not import them into the default book. Rebuilding the demo is destructive to **that demo database** and requires explicit confirmation:

```bash
WEALTHOS_DEMO_REBUILD=wealthos_demo bash backend/rebuild-demo.sh
WEALTHOS_DIST=dist-demo VITE_WEALTHOS_MODE=demo pnpm -C frontend exec vite build
DB_LOCAL_NAME=wealthos_demo WEALTHOS_DEMO_PERSONA=chen WEALTHOS_STATIC_DIR=frontend/dist-demo PORT=8790 bash scripts/start.sh --background
curl --fail --silent http://127.0.0.1:8790/health
```

Open <http://127.0.0.1:8790>. Stop the demo with `WEALTHOS_STATIC_DIR=frontend/dist-demo bash scripts/stop.sh` before returning to the normal app. Never point fixture import at your real book; the importer also enforces the demo database guard.

## Verification

Fast checks that do not need PostgreSQL:

```bash
pnpm -C frontend test
pnpm -C frontend exec vitest run ../backend/tests/config.test.ts ../backend/tests/migrate-parse.test.ts ../backend/tests/migrations-files.test.ts ../backend/tests/entry-templates.test.ts ../backend/tests/normalize-fixture.test.ts
pnpm -C backend typecheck
pnpm -C frontend typecheck
pnpm -C frontend check:locale
pnpm -C frontend check:assets
pnpm check:public
```

After preparing the synthetic demo, run the real local backend suite:

```bash
LOG_LEVEL=warn WEALTHOS_TEST_DB_CONFIRM=wealthos_test pnpm -C backend test
```

The write suite explicitly rebuilds disposable `wealthos_test`. Never substitute a personal database. Run tests from a clean shell without `DB_LOCAL_NAME`; its confirmation guard is intentional.

Browser checks require a running local service and Chromium:

```bash
pnpm -C frontend exec playwright install chromium
WEB_URL=http://127.0.0.1:8787 pnpm -C frontend exec node e2e/real-backend-smoke.mjs
```

For mock-only UI checks, first build the frontend with `pnpm build`, then use separate terminals in the project root:

```bash
pnpm mock
PORT=8795 node frontend/scripts/serve.mjs
WEB_URL=http://127.0.0.1:8795 pnpm -C frontend exec node e2e/smoke.mjs
WEB_URL=http://127.0.0.1:8795 pnpm -C frontend exec node e2e/i18n.mjs
WEB_URL=http://127.0.0.1:8795 pnpm -C frontend exec node e2e/transaction-commands.mjs
WEB_URL=http://127.0.0.1:8795 pnpm -C frontend exec node e2e/accessibility.mjs
```

`transaction-commands.mjs` intercepts writes in the browser; it is a mock UI test, not evidence of a real database write. Real command coverage is in `backend/tests/writes.test.ts` against `wealthos_test`.

## Local development

Use the mock API for frontend-only development:

```bash
pnpm mock
WEALTHOS_API_TARGET=http://127.0.0.1:3100 pnpm dev
```

For backend development, stop the packaged app first and run `pnpm -C backend dev` against the intended local database. For frontend development with a real local API, keep the backend available and use a separate frontend port:

```bash
WEALTHOS_API_TARGET=http://127.0.0.1:8787 pnpm -C frontend dev -- --port 5173
```

Do not run two backends on the same port. `dist-demo` and other `dist-*` directories are build artifacts, not separate databases. `WEALTHOS_STATIC_DIR` selects the build directory; `DB_LOCAL_NAME` selects the database.

## Pairing and security

Default local mode binds only to loopback and uses the initialized owner book. Pairing is optional and does not make an untrusted network safe:

```bash
WEALTHOS_AUTH=pairing bash scripts/start.sh
```

The console prints a one-time pairing code. Enter it in the browser; do not copy it into source control or public logs. After pairing, the browser stores a session cookie and the API client sends the CSRF token on POST requests.

Keep the service local unless you independently provide appropriate network access controls and TLS. This minimal release intentionally supports only loopback PostgreSQL; use an SSH tunnel for administration of another machine rather than placing cloud credentials in the project.

Back up both the PostgreSQL database and the matching ignored binding/config files using your own protected local backup process. This release does not include a hosted backup service or a backup/restore orchestrator.

## Project map

```text
backend/          Fastify API, migrations, fixtures, bootstrap, tests
frontend/         TypeScript/Vite UI, unit tests, mock API, browser checks
packages/api-client/
                  Generated OpenAPI types and typed client
scripts/          Local setup, database/app lifecycle, public-content scan
licenses/         Font license texts
```

Regenerate API types after deliberately changing the contract:

```bash
pnpm -C packages/api-client generate
pnpm -C frontend typecheck
```

## Troubleshooting

- **`could not bind ... 5433`**: identify the listener; do not delete data directories. Choose Route B with a free port or stop a known disposable instance.
- **`database files are incompatible`**: `initdb` and `pg_ctl` came from different PostgreSQL versions. Set `PG_BIN` to one matching major-version tool directory and recreate only a newly created, disposable data directory.
- **`No ledger binding`**: run `pnpm bootstrap` against the intended local database. Do not substitute a demo persona to hide a missing binding.
- **`database already has a book`**: restore the matching binding from your protected backup; the script intentionally does not adopt or erase it.
- **Authentication failed**: check the ignored `.env`, not a committed example. Rerun setup with the intended local administrator connection to rotate the generated app password.
- **Port already in use for the web app**: use `PORT=8790 bash scripts/start.sh --background`; health-check that same port.
- **Empty charts on a new book**: expected until there are transactions/snapshots; no sample financial data is silently inserted.

## License

MIT; see [LICENSE](LICENSE). Third-party notices and font licenses are in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) and `licenses/`.
