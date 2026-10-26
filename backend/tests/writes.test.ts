/**
 * P2 write-command integration tests — run against a freshly rebuilt
 * wealthos_test database (see write-db.ts). Covers the GT scenario
 * vectors, idempotency (GT-18), period locks (GT-21) and reversal
 * semantics (GT-20 / ADR-204).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config/config.js";
import { rebuildTestDb, type TestDb } from "./write-db.js";
import type { FastifyInstance } from "fastify";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");

let testDb: TestDb;
let admin: Pool; // migration role, for period locks / assertions
let app: FastifyInstance;

beforeAll(async () => {
  testDb = await rebuildTestDb();
  const env: Record<string, string> = {};
  for (const line of readFileSync(resolve(ROOT, ".env"), "utf8").split("\n")) {
    const m = line.match(/^\s*(DB_LOCAL_HOST|DB_LOCAL_PORT|DB_LOCAL_USER|DB_LOCAL_PASSWORD|DB_MIGRATION_USER|DB_MIGRATION_PASSWORD)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]!] = m[2]!;
  }
  const cfg = loadConfig(
    { ...env, DATABASE_PROFILE: "local", DB_LOCAL_NAME: "wealthos_test" },
    ROOT,
  );
  expect(cfg.database.name).toBe("wealthos_test");
  admin = new Pool({
    host: cfg.database.host, port: cfg.database.port, database: "wealthos_test",
    user: cfg.database.migrationUser ?? cfg.database.user,
    password: cfg.database.migrationPassword ?? cfg.database.password,
    max: 2,
  });
  // the app uses its own pool pointed at the same test DB
  const appCfg = { ...cfg, database: { ...cfg.database, name: "wealthos_test" } };
  app = buildApp({ config: appCfg, demoPersona: "chen" });
  await app.ready();
}, 120_000);

afterAll(async () => {
  await app?.close();
  await admin?.end();
  await testDb?.close();
});

// helpers ---------------------------------------------------------------

interface AccountMap {
  checking: string; savings: string; alipay: string; brokerage: string;
  pf: string; card: string; mortgage: string; installment: string; receivable: string;
}

async function accountMap(): Promise<AccountMap> {
  // direct pool access needs its own RLS book context
  const c = await testDb.pool.connect();
  try {
    await c.query("SELECT set_config('app.book_id', $1, false)", [
      "45bee24d-0dad-511e-8fb3-0748bf84a983",
    ]);
    const r = await c.query(`SELECT a.name, a.account_id::text FROM accounts a`);
    const byName = Object.fromEntries(r.rows.map((x: any) => [x.name, x.account_id]));
    return {
      checking: byName["招商银行 · 活期"],
      savings: byName["招商银行 · 金葵花储蓄"],
      alipay: byName["支付宝"],
      brokerage: byName["中信证券 · 证券账户"],
      pf: byName["公积金账户"],
      card: byName["中信银行 · 信用卡"],
      mortgage: byName["住房贷款"],
      installment: byName["信用卡分期（合成）"],
      receivable: byName["应收报销款（合成）"],
    };
  } finally {
    c.release();
  }
}

let keySeq = 0;
const nextKey = () => `test-key-${++keySeq}`;

async function post(url: string, payload: unknown, key = nextKey()) {
  const r = await app.inject({
    method: "POST",
    url,
    headers: { "idempotency-key": key },
    payload: payload as object,
  });
  if (r.statusCode >= 400) {
    console.error(`POST ${url} -> ${r.statusCode}:`, JSON.stringify(r.json()).slice(0, 300));
  }
  return { status: r.statusCode, body: r.json(), key };
}

/** admin-pool query with the chen book RLS context. */
async function adminQuery(sql: string, params: unknown[] = []) {
  const c = await admin.connect();
  try {
    await c.query("SELECT set_config('app.book_id', $1, false)", [
      "45bee24d-0dad-511e-8fb3-0748bf84a983",
    ]);
    return c.query(sql, params);
  } finally {
    c.release();
  }
}

async function balanceOf(accountId: string): Promise<number> {
  const r = await app.inject({
    method: "GET", url: `/v1/accounts/${accountId}/balance`,
  });
  return r.json().data.balance_cents;
}

// scenario vectors (FINANCIAL-INVARIANTS §4 / GT-04..GT-10) ---------------

describe("P2 create: scenario vectors", () => {
  it("income (4.3): FUNDING asset + PRIMARY income", async () => {
    const a = await accountMap();
    const r = await post("/v1/transactions", {
      transaction_type: "INCOME",
      amount_cents: 500000,
      transaction_date: "2025-07-05",
      destination_account_id: a.checking, // arrival account (normalized N-01 form)
      category_code: "SALARY_BASE",
      merchant_name: "七月工资",
    });
    expect(r.status).toBe(201);
    const txn = await app.inject({
      method: "GET", url: `/v1/transactions/${r.body.data.transaction_id}`,
    });
    const entries = txn.json().data.entries;
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      direction: "DEBIT", entry_role: "FUNDING", flow_effect: "INCOME_SALARY",
    });
    expect(entries[1]).toMatchObject({
      direction: "CREDIT", entry_role: "PRIMARY", ledger_account_code: expect.stringContaining("4"),
    });
    expect(await balanceOf(a.checking)).toBe(9642050 + 500000);
  });

  it("expense (4.1): bucketed PRIMARY + FUNDING cash", async () => {
    const a = await accountMap();
    const before = await balanceOf(a.checking);
    const r = await post("/v1/transactions", {
      transaction_type: "EXPENSE",
      amount_cents: 12345,
      transaction_date: "2025-07-06",
      source_account_id: a.checking,
      category_code: "FOOD_LUNCH",
      expense_meta: { necessity_level: "ESSENTIAL" },
    });
    expect(r.status).toBe(201);
    const txn = (await app.inject({
      method: "GET", url: `/v1/transactions/${r.body.data.transaction_id}`,
    })).json().data;
    expect(txn.entries[0]).toMatchObject({ expense_bucket: "ESSENTIAL", entry_role: "PRIMARY" });
    expect(txn.entries[1]).toMatchObject({ entry_role: "FUNDING" });
    expect(await balanceOf(a.checking)).toBe(before - 12345);
  });

  it("transfer (4.4): neutral, does not pollute metrics", async () => {
    const a = await accountMap();
    const metricsBefore = (await app.inject({
      method: "GET", url: "/v1/metrics?ids=monthly_total_income,monthly_total_expense&period=2025-07",
    })).json().data.metrics;
    const r = await post("/v1/transactions", {
      transaction_type: "TRANSFER",
      amount_cents: 200000,
      transaction_date: "2025-07-07",
      source_account_id: a.checking,
      destination_account_id: a.savings,
    });
    expect(r.status).toBe(201);
    const metricsAfter = (await app.inject({
      method: "GET", url: "/v1/metrics?ids=monthly_total_income,monthly_total_expense&period=2025-07",
    })).json().data.metrics;
    expect(metricsAfter[0].value_cents).toBe(metricsBefore[0].value_cents);
    expect(metricsAfter[1].value_cents).toBe(metricsBefore[1].value_cents);
  });

  it("credit card purchase (4.2): NO funding leg, liability rises", async () => {
    const a = await accountMap();
    const cardBefore = await balanceOf(a.card);
    const r = await post("/v1/transactions", {
      transaction_type: "CREDIT_CARD_PURCHASE",
      amount_cents: 42000,
      transaction_date: "2025-07-08",
      credit_account_id: a.card,
      category_code: "SHOPPING_ELECTRONICS",
      expense_meta: { necessity_level: "OPTIONAL" },
    });
    expect(r.status).toBe(201);
    const txn = (await app.inject({
      method: "GET", url: `/v1/transactions/${r.body.data.transaction_id}`,
    })).json().data;
    expect(txn.entries).toHaveLength(2);
    expect(txn.entries.every((e: any) => e.entry_role === "PRIMARY")).toBe(true);
    expect(await balanceOf(a.card)).toBe(cardBefore + 42000);
  });

  it("loan repayment (4.7): 6 legs when P/I/F all non-zero, mortgage falls", async () => {
    const a = await accountMap();
    const mortgageBefore = await balanceOf(a.mortgage);
    const r = await post("/v1/transactions", {
      transaction_type: "LOAN_REPAYMENT",
      amount_cents: 684350,
      transaction_date: "2025-07-10",
      source_account_id: a.checking,
      destination_account_id: a.mortgage,
      repayment: { principal_cents: 392915, interest_cents: 291435, fees_cents: 0 },
    });
    expect(r.status).toBe(201);
    const txn = (await app.inject({
      method: "GET", url: `/v1/transactions/${r.body.data.transaction_id}`,
    })).json().data;
    expect(txn.entries).toHaveLength(4); // fees=0 -> 4 non-zero legs
    expect(await balanceOf(a.mortgage)).toBe(mortgageBefore - 392915);
  });

  it("repayment split mismatch is a 422 SPLIT_MISMATCH", async () => {
    const a = await accountMap();
    const r = await post("/v1/transactions", {
      transaction_type: "LOAN_REPAYMENT",
      amount_cents: 600000,
      transaction_date: "2025-07-11",
      source_account_id: a.checking,
      destination_account_id: a.mortgage,
      repayment: { principal_cents: 400000, interest_cents: 100000, fees_cents: 0 },
    });
    expect(r.status).toBe(422);
    expect(r.body.code).toBe("SPLIT_MISMATCH");
  });

  it("refund (4.8): reverses in the refund month with bucket", async () => {
    const a = await accountMap();
    const r = await post("/v1/transactions", {
      transaction_type: "REFUND",
      amount_cents: 9900,
      transaction_date: "2025-07-12",
      destination_account_id: a.alipay,
      category_code: "OTHER_UNCLASSIFIED",
    });
    expect(r.status).toBe(201);
    const txn = (await app.inject({
      method: "GET", url: `/v1/transactions/${r.body.data.transaction_id}`,
    })).json().data;
    const primary = txn.entries.find((e: any) => e.entry_role === "PRIMARY");
    expect(primary.expense_bucket).toBe("REFUND_REVERSAL");
  });

  it("audit and outbox rows are written for creates", async () => {
    const audit = await app.inject({ method: "GET", url: "/v1/audit-logs?limit=10" });
    const rows = audit.json().data;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.some((r: any) => r.operation_type === "CREATE")).toBe(true);
    const outbox = await adminQuery(
      `SELECT count(*)::int AS c FROM outbox_events WHERE event_type = 'transaction.created'`,
    );
    expect(outbox.rows[0].c).toBeGreaterThan(0);
  });
});

describe("P2 idempotency (GT-18)", () => {
  it("same key + same body creates exactly one transaction", async () => {
    const a = await accountMap();
    const body = {
      transaction_type: "EXPENSE",
      amount_cents: 777,
      transaction_date: "2025-07-13",
      source_account_id: a.checking,
      category_code: "FOOD_BEVERAGES",
      expense_meta: { necessity_level: "OPTIONAL" },
    };
    const first = await post("/v1/transactions", body, "dup-key-1");
    const second = await post("/v1/transactions", body, "dup-key-1");
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body.data.transaction_id).toBe(first.body.data.transaction_id);
    const txns = await adminQuery(
      `SELECT count(*)::int AS c FROM transactions WHERE idempotency_key = 'dup-key-1'`,
    );
    expect(txns.rows[0].c).toBe(1);
  });

  it("same key + different body is a 409", async () => {
    const a = await accountMap();
    const first = await post("/v1/transactions", {
      transaction_type: "EXPENSE", amount_cents: 100,
      transaction_date: "2025-07-14", source_account_id: a.checking,
      category_code: "FOOD_BEVERAGES",
    }, "dup-key-2");
    expect(first.status).toBe(201);
    const conflict = await post("/v1/transactions", {
      transaction_type: "EXPENSE", amount_cents: 999, // different body
      transaction_date: "2025-07-14", source_account_id: a.checking,
      category_code: "FOOD_BEVERAGES",
    }, "dup-key-2");
    expect(conflict.status).toBe(409);
    expect(conflict.body.code).toBe("IDEMPOTENCY_CONFLICT");
  });

  it("missing Idempotency-Key is a 400", async () => {
    const r = await app.inject({
      method: "POST", url: "/v1/transactions", payload: {},
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().code).toBe("IDEMPOTENCY_KEY_REQUIRED");
  });

  it("concurrent same-key submits produce one transaction", async () => {
    const a = await accountMap();
    const body = {
      transaction_type: "EXPENSE",
      amount_cents: 555,
      transaction_date: "2025-07-15",
      source_account_id: a.checking,
      category_code: "FOOD_BEVERAGES",
      expense_meta: { necessity_level: "OPTIONAL" },
    };
    const [r1, r2] = await Promise.all([
      post("/v1/transactions", body, "race-key"),
      post("/v1/transactions", body, "race-key"),
    ]);
    const statuses = [r1.status, r2.status].sort();
    expect(statuses[0]).toBe(201);
    expect(statuses[1]).toBeGreaterThanOrEqual(201); // 201 (replay) or 409 in-progress
    const txns = await adminQuery(
      `SELECT count(*)::int AS c FROM transactions WHERE idempotency_key = 'race-key'`,
    );
    expect(txns.rows[0].c).toBe(1);
  });
});

describe("P2 period lock (GT-21)", () => {
  it("writes into a closed period are rejected with 422 PERIOD_CLOSED", async () => {
    const a = await accountMap();
    // close 2025-08 as the book owner (admin op, outside the API for now)
    await admin.query("SELECT set_config('app.book_id', $1, false)", [
      "45bee24d-0dad-511e-8fb3-0748bf84a983",
    ]);
    await admin.query(
      `INSERT INTO period_locks (book_id, period_start, status, closed_at, closed_by)
       VALUES ('45bee24d-0dad-511e-8fb3-0748bf84a983'::uuid, '2025-08-01', 'CLOSED', now(), NULL)`,
    );
    const r = await post("/v1/transactions", {
      transaction_type: "EXPENSE",
      amount_cents: 100,
      transaction_date: "2025-08-20",
      source_account_id: a.checking,
      category_code: "FOOD_BEVERAGES",
    });
    expect(r.status).toBe(422);
    expect(r.body.code).toBe("PERIOD_CLOSED");
  });
});

describe("P2 reversal (GT-20 / ADR-204)", () => {
  it("void creates a reversal; original stays stored-POSTED but derives VOIDED; net effect zero", async () => {
    const a = await accountMap();
    const before = await balanceOf(a.checking);
    const created = await post("/v1/transactions", {
      transaction_type: "EXPENSE",
      amount_cents: 30000,
      transaction_date: "2025-07-20",
      source_account_id: a.checking,
      category_code: "FOOD_LUNCH",
      expense_meta: { necessity_level: "ESSENTIAL" },
    });
    expect(created.status).toBe(201);
    expect(await balanceOf(a.checking)).toBe(before - 30000);

    const voided = await post(
      `/v1/transactions/${created.body.data.transaction_id}/void`,
      { reason: "录错了" },
    );
    expect(voided.status).toBe(201);

    // balances restored
    expect(await balanceOf(a.checking)).toBe(before);

    // original derives VOIDED, entries still present
    const orig = (await app.inject({
      method: "GET", url: `/v1/transactions/${created.body.data.transaction_id}`,
    })).json().data;
    expect(orig.status).toBe("VOIDED");
    expect(orig.entries.length).toBe(2);
    expect(orig.voided_by_transaction_id).toBe(voided.body.data.transaction_id);

    // reversal references the original; both legs net to zero
    const reversal = (await app.inject({
      method: "GET", url: `/v1/transactions/${voided.body.data.transaction_id}`,
    })).json().data;
    expect(reversal.related_transaction_id).toBe(created.body.data.transaction_id);
    expect(reversal.entries).toHaveLength(2);
    const net = [...orig.entries, ...reversal.entries].reduce(
      (s, e) => s + (e.direction === "DEBIT" ? e.amount_cents : -e.amount_cents), 0,
    );
    expect(net).toBe(0);

    // double void -> 422
    const again = await post(
      `/v1/transactions/${created.body.data.transaction_id}/void`, {},
    );
    expect(again.status).toBe(422);
    expect(again.body.code).toBe("ALREADY_VOIDED");

    // voiding a reversal -> 422 (B-21)
    const voidReversal = await post(
      `/v1/transactions/${voided.body.data.transaction_id}/void`, {},
    );
    expect(voidReversal.status).toBe(422);
    expect(voidReversal.body.code).toBe("NOT_VOIDABLE");
  });
});
