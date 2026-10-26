import { describe, it, expect } from "vitest";
import { loadMigrations, MIGRATION_FILENAME_RE } from "../src/database/migrate.js";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");

describe("migration files", () => {
  it("all have valid names and no id gaps", () => {
    const ms = loadMigrations(resolve(ROOT, "database/migrations"));
    expect(ms.length).toBeGreaterThanOrEqual(3);
    expect(ms.map((m) => m.name)).toContain("0001_init.sql");
    expect(ms.map((m) => m.name)).toContain("0002_rls_book_isolation.sql");
    expect(ms.map((m) => m.name)).toContain("0003_same_book_integrity.sql");
  });

  it("0002 uses NULLIF guard in the policy helper", () => {
    const ms = loadMigrations(resolve(ROOT, "database/migrations"));
    const rls = ms.find((m) => m.name === "0002_rls_book_isolation.sql");
    expect(rls).toBeDefined();
    expect(rls!.sql).toContain("NULLIF(current_setting('app.book_id', true), '')::uuid");
    expect(rls!.sql).toContain("FORCE ROW LEVEL SECURITY");
  });

  it("0001 does not wrap itself in BEGIN/COMMIT (runner owns the tx)", () => {
    const ms = loadMigrations(resolve(ROOT, "database/migrations"));
    const init = ms.find((m) => m.name === "0001_init.sql");
    expect(init).toBeDefined();
    expect(init!.sql.trimStart().startsWith("BEGIN;")).toBe(false);
  });
});
