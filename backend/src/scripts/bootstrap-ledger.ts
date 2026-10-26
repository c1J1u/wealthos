#!/usr/bin/env tsx
/** Prepare an empty local book without creating any financial transactions. */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { loadConfig } from "../config/config.js";
import { migrateUp } from "../database/migrate.js";

const ROOT = resolve(import.meta.dirname, "../..");
const BINDING = resolve(ROOT, ".ledger.json");
const OWNER_EMAIL = "owner@wealthos.local";
type Binding = { user_id: string; book_id: string };

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function savedBinding(): Binding | null {
  if (!existsSync(BINDING)) return null;
  const value = JSON.parse(readFileSync(BINDING, "utf8")) as Partial<Binding>;
  return value.user_id && value.book_id ? value as Binding : null;
}

async function main() {
  const displayName = arg("display-name") ?? "所有者";
  const bookName = arg("book-name") ?? "我的账本";
  const cfg = loadConfig(undefined, ROOT);
  if (cfg.database.name === "wealthos_demo" || cfg.database.name === "wealthos_test") {
    throw new Error("Bootstrap is for your own book, not the disposable demo or test database.");
  }
  const pool = new Pool({
    host: cfg.database.host, port: cfg.database.port, database: cfg.database.name,
    user: cfg.database.migrationUser ?? cfg.database.user,
    password: cfg.database.migrationPassword ?? cfg.database.password, max: 1,
  });
  console.log(`Local database: ${cfg.database.name} @ ${cfg.database.host}:${cfg.database.port}`);
  await migrateUp(() => pool.connect(), resolve(ROOT, "database/migrations"));
  const client = await pool.connect();
  try {
    const previous = savedBinding();
    const existing = await client.query<{ book_id: string; owner_user_id: string; name: string }>(
      "SELECT book_id::text, owner_user_id::text, name FROM ledger_books LIMIT 1",
    );
    if (existing.rows.length > 0) {
      const book = existing.rows[0]!;
      if (!previous || previous.book_id !== book.book_id || previous.user_id !== book.owner_user_id) {
        throw new Error("This database already has a book. Restore its original backend/.ledger.json; no data was changed.");
      }
      console.log("The local book is already initialized; no data was changed.");
      return;
    }

    const owner = await client.query<{ user_id: string }>("SELECT user_id::text FROM users WHERE email = $1", [OWNER_EMAIL]);
    const ownerId = owner.rows[0]?.user_id ?? randomUUID();
    const bookId = randomUUID();
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO users (user_id, email, display_name) VALUES ($1, $2, $3)
       ON CONFLICT (user_id) DO UPDATE SET display_name = EXCLUDED.display_name`,
      [ownerId, OWNER_EMAIL, displayName],
    );
    await client.query("SELECT set_config('app.book_id', $1, true)", [bookId]);
    await client.query("INSERT INTO ledger_books (book_id, owner_user_id, name) VALUES ($1, $2, $3)", [bookId, ownerId, bookName]);
    await client.query("INSERT INTO memberships (book_id, user_id, role) VALUES ($1, $2, 'OWNER')", [bookId, ownerId]);
    await client.query(
      `INSERT INTO accounts (account_id, book_id, name, type, subtype, normal_side, liquidity_level)
       VALUES ($1, $2, '现金', 'CASH', 'CASH', 'ASSET', 'INSTANT')`, [randomUUID(), bookId],
    );
    const account = await client.query<{ account_id: string }>("SELECT account_id::text FROM accounts WHERE book_id = $1", [bookId]);
    const accountId = account.rows[0]!.account_id;
    await client.query(
      `INSERT INTO ledger_accounts (ledger_account_id, book_id, code, name, class, normal_side, account_id)
       VALUES ($1, $2, '1001', 'Cash', 'ASSET', 'DEBIT', $3),
              ($4, $2, '3001', 'Opening Balance', 'EQUITY', 'CREDIT', NULL)`,
      [randomUUID(), bookId, accountId, randomUUID()],
    );
    await client.query(
      `INSERT INTO ledger_accounts (ledger_account_id, book_id, code, name, class, normal_side, category_code)
       SELECT gen_random_uuid(), $1,
              (CASE kind WHEN 'INCOME' THEN 4000 ELSE 5000 END + row_number() OVER (PARTITION BY kind ORDER BY category_code))::text,
              name_zh, kind, CASE kind WHEN 'INCOME' THEN 'CREDIT' ELSE 'DEBIT' END, category_code
         FROM categories WHERE parent_code IS NOT NULL AND archived_at IS NULL`,
      [bookId],
    );
    await client.query("COMMIT");
    writeFileSync(BINDING, JSON.stringify({ user_id: ownerId, book_id: bookId }, null, 2), { mode: 0o600 });
    console.log("Initialized one owner book, a zero-balance cash account, and income/expense categories.");
    console.log("No transactions were created. Start with `bash scripts/start.sh`.");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
