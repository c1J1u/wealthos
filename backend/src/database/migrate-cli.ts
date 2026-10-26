#!/usr/bin/env tsx
/**
 * Migration CLI: `migrate.ts up|status`
 * Connects with the migration role (DB_MIGRATION_USER), applies pending
 * migrations from database/migrations.
 */
import { Pool } from "pg";
import { loadConfig } from "../config/config.js";
import { loadMigrations, appliedIds, ensureSchemaMigrations, applyMigration } from "./migrate.js";
import { resolve } from "node:path";

async function main() {
  const cmd = process.argv[2] ?? "status";
  const root = resolve(import.meta.dirname, "../..");
  const cfg = loadConfig(undefined, root);

  const user = cfg.database.migrationUser ?? cfg.database.user;
  const password = cfg.database.migrationPassword ?? cfg.database.password;
  if (!password) {
    console.error("Migration role password missing (DB_MIGRATION_PASSWORD).");
    process.exit(2);
  }

  const pool = new Pool({
    host: cfg.database.host,
    port: cfg.database.port,
    database: cfg.database.name,
    user,
    password,
    max: 1,
  });

  const dir = resolve(root, "database/migrations");
  const migrations = loadMigrations(dir);

  const client = await pool.connect();
  try {
    if (cmd === "status") {
      await ensureSchemaMigrations(client);
      const done = new Set(await appliedIds(client));
      for (const m of migrations) {
        console.log(`${done.has(m.id) ? "[x]" : "[ ]"} ${m.name}`);
      }
      return;
    }
    if (cmd !== "up") {
      console.error(`Unknown command: ${cmd} (use up|status)`);
      process.exit(2);
    }

    await client.query("BEGIN");
    await ensureSchemaMigrations(client);
    const done = new Set(await appliedIds(client));
    let n = 0;
    for (const m of migrations) {
      if (done.has(m.id)) continue;
      process.stdout.write(`applying ${m.name} ... `);
      await applyMigration(client, m);
      console.log("ok");
      n++;
    }
    await client.query("COMMIT");
    console.log(`\n${n} migration(s) applied, ${done.size} already present.`);
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("\nMigration FAILED, rolled back:");
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
