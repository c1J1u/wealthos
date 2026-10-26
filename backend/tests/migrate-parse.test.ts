import { describe, it, expect } from "vitest";
import { parseMigrationSql, MIGRATION_FILENAME_RE } from "../src/database/migrate.js";

describe("MIGRATION_FILENAME_RE", () => {
  it("accepts NNNN_name.sql", () => {
    expect(MIGRATION_FILENAME_RE.test("0001_init.sql")).toBe(true);
    expect(MIGRATION_FILENAME_RE.test("0012_rls_policies.sql")).toBe(true);
  });
  it("rejects malformed names", () => {
    expect(MIGRATION_FILENAME_RE.test("1_init.sql")).toBe(false);
    expect(MIGRATION_FILENAME_RE.test("0001init.sql")).toBe(false);
    expect(MIGRATION_FILENAME_RE.test("init.sql")).toBe(false);
    expect(MIGRATION_FILENAME_RE.test("0001_init.SQL")).toBe(false);
  });
});

describe("parseMigrationSql", () => {
  it("keeps psql-style comments and treats whole body as one tx", () => {
    const out = parseMigrationSql("-- comment\nCREATE TABLE a (id int);\n-- more\nCREATE TABLE b (id int);");
    expect(out).toEqual([
      expect.stringContaining("-- comment"),
    ]);
    expect(out.length).toBe(1);
  });

  it("splits on lines that are exactly \\i or \\ir", () => {
    const out = parseMigrationSql(
      "CREATE TABLE a (id int);\n\\i other.sql\nCREATE TABLE b (id int);",
    );
    // our runner does not support \i; it must surface an error marker instead of silently skipping
    expect(out.some((s) => s.includes("not supported"))).toBe(true);
  });
});
