/**
 * Golden integration tests — FINANCIAL-INVARIANTS.md §5.2 frozen values,
 * computed from REAL imported ledger data on the demo database.
 * Prereq: bash rebuild-demo.sh (demo DB imported).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Pool, type PoolClient } from "pg";
import { loadConfig } from "../src/config/config.js";
import { flowFigures } from "../src/modules/analytics/metrics.js";
import { stockFigures } from "../src/modules/analytics/balances.js";
import { fixtureId } from "../src/scripts/fixture-ids.js";

const ROOT = resolve(import.meta.dirname, "..");
const DEMO_DB = "wealthos_demo";

let client: PoolClient;
let pool: Pool;

beforeAll(async () => {
  const cfg = loadConfig({ ...readEnvFile(), DATABASE_PROFILE: "local", DB_LOCAL_NAME: DEMO_DB }, ROOT);
  expect(cfg.database.name).toBe(DEMO_DB);
  const user = cfg.database.migrationUser ?? cfg.database.user;
  const password = cfg.database.migrationPassword ?? cfg.database.password;
  pool = new Pool({
    host: cfg.database.host, port: cfg.database.port, database: DEMO_DB,
    user, password, max: 1,
  });
  client = await pool.connect();
});

afterAll(async () => {
  client?.release();
  await pool?.end();
});

function readEnvFile(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of readFileSync(resolve(ROOT, ".env"), "utf8").split("\n")) {
    const m = line.match(/^\s*(DB_LOCAL_HOST|DB_LOCAL_PORT|DB_LOCAL_USER|DB_LOCAL_PASSWORD|DB_MIGRATION_USER|DB_MIGRATION_PASSWORD)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]!] = m[2]!;
  }
  out.LOG_LEVEL = "warn";
  return out;
}

const bookOf = (persona: string) => fixtureId(persona, "book", persona);

/** Session-level RLS context for direct SQL tests. */
async function useBook(persona: string): Promise<string> {
  const bookId = bookOf(persona);
  await client.query("SELECT set_config('app.book_id', $1, false)", [bookId]);
  return bookId;
}

describe("golden flow metrics — frozen §5.2", () => {
  it("chen 2025-06 matches all 12 frozen values", async () => {
    await useBook("chen");
    const f = await flowFigures(client, bookOf("chen"), "2025-06");
    expect(f.income_cents).toBe(3450000n);
    expect(f.essential_cents).toBe(288050n);
    expect(f.discretionary_cents).toBe(90900n);
    expect(f.financial_cost_cents).toBe(291435n);
    expect(f.refund_reversal_cents).toBe(15800n);
    expect(f.expense_cents).toBe(654585n);
    expect(f.principal_cents).toBe(392915n);
    expect(f.interest_cents).toBe(291435n);
    expect(f.fees_cents).toBe(0n);
    const inc = Number(f.income_cents);
    expect(Number(f.principal_cents + f.interest_cents) / inc).toBeCloseTo(0.198362, 6);
    expect(Number(f.income_cents - f.expense_cents) / inc).toBeCloseTo(0.810265, 6);
    expect(Number(f.income_cents - f.expense_cents + f.principal_cents) / inc).toBeCloseTo(0.924154, 6);
  });

  // (persona, month, Inc, ESS, DISC, FIN, REFUND, Exp, P) — frozen monthly table
  const monthly: Array<[string, string, bigint, bigint, bigint, bigint, bigint, bigint, bigint]> = [
    ["chen", "2025-03", 3370000n, 112800n, 46800n, 0n, 0n, 159600n, 0n],
    ["chen", "2025-04", 4050000n, 235400n, 220000n, 294120n, 0n, 749520n, 390230n],
    ["chen", "2025-05", 3568000n, 154900n, 145100n, 292777n, 0n, 592777n, 391573n],
    ["chen", "2025-06", 3450000n, 288050n, 90900n, 291435n, 15800n, 654585n, 392915n],
    ["me", "2025-03", 850000n, 386041n, 75959n, 0n, 0n, 462000n, 200000n],
    ["me", "2025-04", 850000n, 375819n, 86181n, 0n, 0n, 462000n, 200000n],
    ["me", "2025-05", 850000n, 393516n, 68484n, 0n, 0n, 462000n, 200000n],
    ["me", "2025-06", 850000n, 387138n, 74862n, 0n, 0n, 462000n, 200000n],
  ];

  for (const [persona, month, inc, ess, disc, fin, ref, exp, p] of monthly) {
    it(`${persona} ${month} trend row`, async () => {
      await useBook(persona);
      const f = await flowFigures(client, bookOf(persona), month);
      expect(f.income_cents).toBe(inc);
      expect(f.essential_cents).toBe(ess);
      expect(f.discretionary_cents).toBe(disc);
      expect(f.financial_cost_cents).toBe(fin);
      expect(f.refund_reversal_cents).toBe(ref);
      expect(f.expense_cents).toBe(exp);
      expect(f.principal_cents).toBe(p);
    });
  }
});

describe("golden stock figures — frozen §5.2 current point", () => {
  it("chen at 2025-06-30", async () => {
    await useBook("chen");
    const st = await stockFigures(client, bookOf("chen"), "2025-06-30");
    expect(st.account_assets_cents).toBe(81037130n);
    expect(st.positions_value_cents).toBe(43075000n);
    expect(st.total_assets_cents).toBe(124112130n);
    expect(st.total_liabilities_cents).toBe(100743080n);
    expect(st.net_worth_cents).toBe(23369050n);
    expect(st.cash_reserve_cents).toBe(62637130n);
    expect(st.liquid_assets_cents).toBe(62637130n);
  });

  it("me keeps its negative net worth", async () => {
    await useBook("me");
    const st = await stockFigures(client, bookOf("me"), "2025-06-30");
    expect(st.total_assets_cents).toBe(2047930n);
    expect(st.total_liabilities_cents).toBe(3000000n);
    expect(st.net_worth_cents).toBe(-952070n);
  });
});

describe("as-of replay (handoff P0-3)", () => {
  it("before the first posting everything is zero", async () => {
    await useBook("chen");
    const st = await stockFigures(client, bookOf("chen"), "1900-01-01");
    expect(st.total_assets_cents).toBe(0n);
    expect(st.total_liabilities_cents).toBe(0n);
    expect(st.net_worth_cents).toBe(0n);
  });

  it("positions are excluded when their only price is after as_of", async () => {
    // chen's single market price is dated 2025-06-14; in March there is none.
    await useBook("chen");
    const st = await stockFigures(client, bookOf("chen"), "2025-03-31");
    expect(st.positions_value_cents).toBe(0n);
    expect(st.total_assets_cents).toBe(st.account_assets_cents);
  });

  it("mid-month replay differs from month-end", async () => {
    await useBook("chen");
    const mid = await stockFigures(client, bookOf("chen"), "2025-06-05");
    const end = await stockFigures(client, bookOf("chen"), "2025-06-30");
    expect(mid.total_assets_cents).toBeLessThan(end.total_assets_cents);
  });
});
