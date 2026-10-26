/**
 * Write-test database bootstrap: wealthos_test is rebuilt from scratch for
 * every run (FI-04 immutability makes the database itself the sandbox).
 * Never touches wealthos_demo or the real wealthos book.
 */
import { Pool, type PoolClient } from "pg";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadConfig } from "../src/config/config.js";
import { migrateUp } from "../src/database/migrate.js";
import { importPersona } from "../src/scripts/import-fixtures.js";
import { normalizeFixture } from "../src/scripts/normalize-fixture.js";
import { setForceRls } from "../src/database/local-fixtures.js";

const ROOT = resolve(import.meta.dirname, "..");
const TEST_DB = "wealthos_test";

export interface TestDb {
  pool: Pool;
  dbName: string;
  close(): Promise<void>;
}

function adminEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of readFileSync(resolve(ROOT, ".env"), "utf8").split("\n")) {
    const m = line.match(/^\s*(DB_LOCAL_HOST|DB_LOCAL_PORT|DB_MIGRATION_USER|DB_MIGRATION_PASSWORD|DB_LOCAL_USER|DB_LOCAL_PASSWORD)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]!] = m[2]!;
  }
  out.LOG_LEVEL = "warn";
  return out;
}

export async function rebuildTestDb(): Promise<TestDb> {
  if (process.env.WEALTHOS_TEST_DB_CONFIRM !== "wealthos_test") {
    throw new Error("Set WEALTHOS_TEST_DB_CONFIRM=wealthos_test to authorize rebuilding the disposable test database.");
  }
  const env = adminEnv();
  if (process.env.DB_LOCAL_NAME) {
    throw new Error("Unset DB_LOCAL_NAME before running tests; explicit test targets must not be overridden by the shell.");
  }
  const cfg = loadConfig(
    { ...env, DATABASE_PROFILE: "local", DB_LOCAL_NAME: "postgres" },
    ROOT,
  );
  const adminUser = cfg.database.migrationUser ?? cfg.database.user;
  const adminPassword = cfg.database.migrationPassword ?? cfg.database.password;

  // 1. drop + create as admin on the maintenance database
  const admin = new Pool({
    host: cfg.database.host, port: cfg.database.port, database: "postgres",
    user: adminUser, password: adminPassword,  max: 1,
  });
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${TEST_DB}`);
  } finally {
    await admin.end();
  }

  // 2. migrate (admin = owner; RLS FORCE applies to owner too)
  const migPool = new Pool({
    host: cfg.database.host, port: cfg.database.port, database: TEST_DB,
    user: adminUser, password: adminPassword,  max: 1,
  });
  try {
    // migrateUp owns (and releases) its own client
    await migrateUp(() => migPool.connect(), resolve(ROOT, "database/migrations"));
    const grantClient = await migPool.connect();
    try {
      await grantClient.query("GRANT CONNECT ON DATABASE wealthos_test TO wealthos_app");
      await grantClient.query("GRANT USAGE ON SCHEMA public TO wealthos_app");
      await grantClient.query("GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO wealthos_app");
      await grantClient.query("GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO wealthos_app");
    } finally {
      grantClient.release();
    }
    // Only this disposable database temporarily relaxes FORCE RLS for import.
    const importClient = await migPool.connect();
    try {
      await setForceRls(importClient, false);
      try {
        const raw = JSON.parse(readFileSync(resolve(ROOT, "fixtures/chen.json"), "utf8"));
        await importPersona(importClient as PoolClient, "chen", normalizeFixture(raw));
      } finally {
        await setForceRls(importClient, true);
      }
    } finally {
      importClient.release();
    }
  } finally {
    await migPool.end();
  }

  // 3. app-role pool for the tests themselves
  const pool = new Pool({
    host: cfg.database.host, port: cfg.database.port, database: TEST_DB,
    user: cfg.database.user, password: cfg.database.password,
     max: 4,
  });
  return { pool, dbName: TEST_DB, close: () => pool.end() };
}

/** chen book id (deterministic UUIDv5, same as the importer). */
export const CHEN_BOOK = "45bee24d-0dad-511e-8fb3-0748bf84a983";
