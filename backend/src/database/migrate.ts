import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { PoolClient } from "pg";

export const MIGRATION_FILENAME_RE = /^\d{4}_[a-z0-9_]+\.sql$/;

export interface MigrationFile {
  id: number;
  name: string;
  path: string;
  /** full body; executed inside one transaction */
  sql: string;
}

/**
 * A migration file is ONE transaction: no \i / COPYFROM psql meta commands.
 * Comments stay inline (they are legal SQL).
 */
export function parseMigrationSql(sql: string): string[] {
  const lines = sql.split("\n");
  const chunks: string[] = [];
  const errors: string[] = [];
  let current: string[] = [];
  for (const line of lines) {
    const meta = line.match(/^\s*\\[a-z]+\s*(.*)$/);
    if (meta) {
      errors.push(`-- psql meta command not supported by runner: ${line.trim()}`);
      continue;
    }
    current.push(line);
  }
  if (errors.length > 0) {
    // Surface unsupported constructs rather than silently skipping them.
    return [...errors, ...chunks, current.join("\n")].filter((s) => s.trim().length > 0);
  }
  const body = current.join("\n");
  return body.trim().length > 0 ? [body] : [];
}

export function loadMigrations(dir: string): MigrationFile[] {
  const files = readdirSync(dir)
    .filter((f) => MIGRATION_FILENAME_RE.test(f))
    .sort();
  const seen = new Set<number>();
  const out: MigrationFile[] = [];
  for (const f of files) {
    const id = Number(f.slice(0, 4));
    if (seen.has(id)) {
      throw new Error(`Duplicate migration id: ${f} (id ${id} already used)`);
    }
    seen.add(id);
    out.push({
      id,
      name: f,
      path: join(dir, f),
      sql: readFileSync(join(dir, f), "utf8"),
    });
  }
  if (out.length > 0) {
    const ids = out.map((m) => m.id);
    for (let i = 1; i < ids.length; i++) {
      if (ids[i]! - ids[i - 1]! !== 1) {
        throw new Error(
          `Migration id gap between ${out[i - 1]!.name} and ${out[i]!.name}`,
        );
      }
    }
  }
  return out;
}

export async function ensureSchemaMigrations(client: PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}

export async function appliedIds(client: PoolClient): Promise<number[]> {
  const r = await client.query<{ id: number }>(
    "SELECT id FROM schema_migrations ORDER BY id",
  );
  return r.rows.map((row) => row.id);
}

export async function applyMigration(
  client: PoolClient,
  m: MigrationFile,
): Promise<void> {
  const chunks = parseMigrationSql(m.sql);
  if (chunks.some((c) => c.includes("not supported"))) {
    throw new Error(`Migration ${m.name} contains unsupported psql meta commands`);
  }
  for (const chunk of chunks) {
    await client.query(chunk);
  }
  await client.query("INSERT INTO schema_migrations (id, name) VALUES ($1, $2)", [
    m.id,
    m.name,
  ]);
}

export async function migrateUp(
  getClient: () => Promise<PoolClient>,
  migrationsDir: string,
): Promise<{ applied: string[]; skipped: number }> {
  const migrations = loadMigrations(migrationsDir);
  const client = await getClient();
  try {
    await client.query("BEGIN");
    await ensureSchemaMigrations(client);
    const done = new Set(await appliedIds(client));
    const applied: string[] = [];
    for (const m of migrations) {
      if (done.has(m.id)) continue;
      await applyMigration(client, m);
      applied.push(m.name);
    }
    await client.query("COMMIT");
    return { applied, skipped: done.size };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export function migrationsDir(root?: string): string {
  return resolve(root ?? process.cwd(), "database", "migrations");
}
