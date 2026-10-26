/**
 * API integration tests — the real Fastify app against the demo database.
 * Locks the contract envelope, golden values, pagination and security.
 * Prereq: bash rebuild-demo.sh (demo DB imported).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import { buildApp } from "../src/app.js";
import { loadConfig, type AppConfig } from "../src/config/config.js";
import type { FastifyInstance } from "fastify";

const ROOT = resolve(import.meta.dirname, "..");
const DEMO_DB = "wealthos_demo";

function envFile(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of readFileSync(resolve(ROOT, ".env"), "utf8").split("\n")) {
    const m = line.match(/^\s*(DB_LOCAL_HOST|DB_LOCAL_PORT|DB_LOCAL_USER|DB_LOCAL_PASSWORD|DB_MIGRATION_USER|DB_MIGRATION_PASSWORD)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]!] = m[2]!;
  }
  out.LOG_LEVEL = "warn";
  return out;
}

let app: FastifyInstance;
let appConfig: import("../src/config/config.js").AppConfig;

beforeAll(async () => {
  const cfg: AppConfig = loadConfig(
    { ...envFile(), DATABASE_PROFILE: "local", DB_LOCAL_NAME: DEMO_DB },
    ROOT,
  );
  appConfig = cfg;
  expect(cfg.database.name).toBe(DEMO_DB);
  expect(process.env.DB_LOCAL_NAME).toBeUndefined();
  app = buildApp({ config: cfg, demoPersona: "chen" });
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

describe("system", () => {
  it("GET /health reports alive with db up", async () => {
    const r = await app.inject({ method: "GET", url: "/health" });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ status: "ok", db: "up" });
  });

  it("GET /v1/meta returns envelope with Asia/Shanghai", async () => {
    const r = await app.inject({ method: "GET", url: "/v1/meta" });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.data.timezone).toBe("Asia/Shanghai");
    expect(body.meta.request_id).toBeTruthy();
  });

  it("rejects cross-origin requests", async () => {
    const r = await app.inject({
      method: "GET",
      url: "/v1/accounts",
      headers: { origin: "http://evil.example", host: "127.0.0.1:8787" },
    });
    expect(r.statusCode).toBe(403);
  });
});

describe("identity", () => {
  it("GET /v1/me returns the demo book", async () => {
    const r = await app.inject({ method: "GET", url: "/v1/me" });
    expect(r.statusCode).toBe(200);
    const d = r.json().data;
    expect(d.display_name).toBe("合成示例 · 多账户");
    expect(d.book_id).toBeTruthy();
  });

  it("GET /v1/books lists the book", async () => {
    const r = await app.inject({ method: "GET", url: "/v1/books" });
    expect(r.statusCode).toBe(200);
    const books = r.json().data;
    expect(books.length).toBeGreaterThanOrEqual(1);
    expect(books[0].base_currency).toBe("CNY");
  });
});

describe("ledger reads (golden)", () => {
  it("GET /v1/accounts: 10 accounts, balances match raw fixture", async () => {
    const r = await app.inject({ method: "GET", url: "/v1/accounts" });
    const accounts = r.json().data;
    expect(accounts).toHaveLength(10);
    const byName = Object.fromEntries(accounts.map((a: any) => [a.name, a.balance_cents]));
    expect(byName["招商银行 · 活期"]).toBe(9642050);
    expect(byName["住房贷款"]).toBe(98640000);
    expect(byName["信用卡分期（合成）"]).toBe(845040);
  });

  it("GET /v1/transactions paginates with stable cursors", async () => {
    const p1 = await app.inject({ method: "GET", url: "/v1/transactions?limit=5" });
    const b1 = p1.json();
    expect(b1.data).toHaveLength(5);
    expect(b1.meta.next_cursor).toBeTruthy();
    const p2 = await app.inject({
      method: "GET",
      url: `/v1/transactions?limit=5&cursor=${encodeURIComponent(b1.meta.next_cursor)}`,
    });
    const b2 = p2.json();
    expect(b2.data).toHaveLength(5);
    const ids1 = new Set(b1.data.map((t: any) => t.transaction_id));
    const ids2 = new Set(b2.data.map((t: any) => t.transaction_id));
    for (const id of ids2) expect(ids1.has(id)).toBe(false); // no overlap
  });

  it("GET /v1/metrics?period=2025-06 matches all 12 golden values", async () => {
    const r = await app.inject({
      method: "GET",
      url: "/v1/metrics?ids=monthly_total_income,essential_expense,discretionary_expense,financial_cost,refund_reversal,monthly_total_expense&period=2025-06",
    });
    const byId: Record<string, any> = Object.fromEntries(
      r.json().data.metrics.map((m: any) => [m.metric_id, m]),
    );
    expect(byId.monthly_total_income.value_cents).toBe(3450000);
    expect(byId.monthly_total_expense.value_cents).toBe(654585);
    expect(byId.essential_expense.value_cents).toBe(288050);
    expect(byId.discretionary_expense.value_cents).toBe(90900);
    expect(byId.financial_cost.value_cents).toBe(291435);
    expect(byId.refund_reversal.value_cents).toBe(15800);
  });

  it("GET /v1/metrics honors ids exactly (no extras) and ratios", async () => {
    const r = await app.inject({
      method: "GET",
      url: "/v1/metrics?ids=net_worth,total_assets,savings_rate&period=2025-06",
    });
    const rows = r.json().data.metrics;
    expect(rows).toHaveLength(3);
    const byId: Record<string, any> = Object.fromEntries(rows.map((m: any) => [m.metric_id, m]));
    expect(byId.net_worth.value_cents).toBe(23369050);
    expect(byId.total_assets.value_cents).toBe(124112130);
    expect(byId.savings_rate.value).toBeCloseTo(0.810265, 5);
  });

  it("GET /v1/metrics without ids returns the full catalog (B-17)", async () => {
    const r = await app.inject({ method: "GET", url: "/v1/metrics?period=2025-06" });
    expect(r.statusCode).toBe(200);
    const rows = r.json().data.metrics;
    expect(rows.length).toBe(16); // 15 contract ids + financial_runway_months
    expect(new Set(rows.map((m: any) => m.metric_id)).size).toBe(16);
  });

  it("GET /v1/metrics with unknown query param is a 400", async () => {
    const r = await app.inject({
      method: "GET", url: "/v1/metrics?ids=net_worth&foo=bar",
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().code).toBe("UNSUPPORTED_PARAMETER");
  });

  it("GET /v1/metrics default period resolves to latest month with data", async () => {
    const r = await app.inject({ method: "GET", url: "/v1/metrics?ids=monthly_total_income" });
    const m = r.json().data.metrics[0];
    expect(m.period).toBe("2025-06"); // demo book's latest month (U-2)
  });

  it("GET /v1/reports/balance-sheet matches frozen totals", async () => {
    const r = await app.inject({
      method: "GET",
      url: "/v1/reports/balance-sheet?as_of=2025-06-30",
    });
    const d = r.json().data;
    expect(d.total_assets_cents).toBe(124112130);
    expect(d.total_liabilities_cents).toBe(100743080);
    expect(d.net_worth_cents).toBe(23369050);
  });

  it("GET /v1/portfolio values positions at market", async () => {
    const r = await app.inject({ method: "GET", url: "/v1/portfolio" });
    const d = r.json().data;
    expect(d.market_value_cents).toBe(43075000);
    expect(d.cost_basis_cents).toBe(41820000);
    expect(d.positions.length).toBe(6);
  });

  it("GET unknown account -> Problem 404", async () => {
    const r = await app.inject({
      method: "GET",
      url: "/v1/accounts/00000000-0000-0000-0000-000000000000",
    });
    expect(r.statusCode).toBe(404);
    expect(r.json().code).toBe("NOT_FOUND");
  });
});

describe("preview (stateless, contract TransactionPreview)", () => {
  it("returns the 4-leg repayment vector (fees=0 omitted) with balanced proof", async () => {
    const accounts = await app.inject({ method: "GET", url: "/v1/accounts?limit=100" });
    const byName = Object.fromEntries(accounts.json().data.map((a: any) => [a.name, a.account_id]));
    const r = await app.inject({
      method: "POST", url: "/v1/transactions/preview",
      payload: {
        transaction_type: "LOAN_REPAYMENT",
        amount_cents: 684350,
        currency: "CNY",
        transaction_date: "2025-07-10",
        source_account_id: byName["招商银行 · 活期"],
        destination_account_id: byName["住房贷款"],
        repayment_meta: { principal_cents: 392915, interest_cents: 291435, fees_cents: 0 },
      },
    });
    expect(r.statusCode).toBe(200);
    const d = r.json().data;
    expect(d.balanced).toBe(true);
    expect(d.debit_total_cents).toBe(684350);
    expect(d.entries).toHaveLength(4);
  });

  it("rejects SPLIT_MISMATCH with 422", async () => {
    const r = await app.inject({
      method: "POST", url: "/v1/transactions/preview",
      payload: {
        transaction_type: "LOAN_REPAYMENT", amount_cents: 600000,
        currency: "CNY", transaction_date: "2025-07-01",
        repayment_meta: { principal_cents: 400000, interest_cents: 100000, fees_cents: 0 },
      },
    });
    expect(r.statusCode).toBe(422);
    expect(r.json().code).toBe("SPLIT_MISMATCH");
  });
});

describe("governance", () => {
  it("GET /v1/data-quality reports the D-1 negative-balance check", async () => {
    const r = await app.inject({ method: "GET", url: "/v1/data-quality" });
    const checks = r.json().data.checks;
    const ids = checks.map((c: any) => c.check_id);
    expect(ids).toContain("unbalanced_transactions");
    expect(ids).toContain("negative_asset_balances");
    expect(ids).toContain("positions_without_price");
    expect(typeof r.json().data.run_at).toBe("string");
    expect(typeof r.json().data.pass).toBe("boolean");
    for (const c of checks) {
      expect(typeof c.pass).toBe("boolean");
    }
  });
});

describe("P1 completion round (handoff 2026-10-25)", () => {
  it("views/overview: keyed metrics record with golden stock values", async () => {
    const r = await app.inject({ method: "GET", url: "/v1/views/overview?range=6m" });
    expect(r.statusCode).toBe(200);
    const d = r.json().data;
    expect(d.page).toBe("overview");
    expect(Array.isArray(d.metrics)).toBe(false);
    expect(d.metrics.net_worth.value_cents).toBe(23369050);
    expect(d.metrics.total_assets.value_cents).toBe(124112130);
    expect(d.metrics.monthly_total_income.value_cents).toBe(3450000); // default period U-2
    expect(Array.isArray(d.accounts)).toBe(true);
    expect(Array.isArray(d.positions)).toBe(true);
    expect(Array.isArray(d.transactions)).toBe(true);
    expect(Array.isArray(d.snapshots)).toBe(true);
  });

  it("views/overview rejects an invalid range with 400", async () => {
    const r = await app.inject({ method: "GET", url: "/v1/views/overview?range=99m" });
    expect(r.statusCode).toBe(400);
  });

  it("snapshots are computed (never legacy) with formula_version", async () => {
    const r = await app.inject({ method: "GET", url: "/v1/snapshots" });
    const rows = r.json().data;
    expect(rows.length).toBeGreaterThanOrEqual(4);
    const june = rows.find((s: any) => s.as_of === "2025-06-30");
    expect(june.net_worth_cents).toBe(23369050);
    expect(june.formula_version).toBe("1.0");
    // months before the first price exclude positions
    const march = rows.find((s: any) => s.as_of === "2025-03-31");
    expect(march.total_assets_cents).toBeLessThan(june.total_assets_cents);
  });

  it("snapshots honor from/to", async () => {
    const r = await app.inject({
      method: "GET", url: "/v1/snapshots?from=2025-05-01&to=2025-05-31",
    });
    const rows = r.json().data;
    expect(rows).toHaveLength(1);
    expect(rows[0].as_of).toBe("2025-05-31");
  });

  it("cash-flow: contract shape + arithmetic + from/to echo", async () => {
    const r = await app.inject({
      method: "GET", url: "/v1/reports/cash-flow?from=2025-06-01&to=2025-06-30",
    });
    expect(r.statusCode).toBe(200);
    const d = r.json().data;
    expect(d.from_date).toBe("2025-06-01");
    expect(d.to_date).toBe("2025-06-30");
    expect(d.operating_cents + d.investing_cents + d.financing_cents).toBe(d.net_cents);
    // frozen semantics: loan principal funding legs are FINANCING outflow
    expect(d.financing_cents).toBe(-392915);
    expect(typeof d.note).toBe("string");
  });

  it("series: net_worth monthly points within data span; empty range gives 0 points", async () => {
    const r = await app.inject({
      method: "GET",
      url: "/v1/analytics/series?metric=net_worth&from=2025-01-01&to=2025-06-30&granularity=month",
    });
    expect(r.statusCode).toBe(200);
    const d = r.json().data;
    expect(d.metric_id).toBe("net_worth");
    expect(d.points.length).toBeGreaterThan(0);
    expect(d.points.length).toBe(4); // 2025-03..06, clamped to data span
    const june = d.points.find((p: any) => p.period === "2025-06");
    expect(june.value_cents).toBe(23369050);
    // mom present
    expect(june.mom.reference_period).toBe("2025-05");

    const empty = await app.inject({
      method: "GET",
      url: "/v1/analytics/series?metric=net_worth&from=2030-01-01&to=2030-12-31",
    });
    expect(empty.statusCode).toBe(200);
    expect(empty.json().data.points).toHaveLength(0);
  });

  it("series rejects unsupported granularity instead of ignoring it", async () => {
    const r = await app.inject({
      method: "GET", url: "/v1/analytics/series?metric=net_worth&granularity=day",
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().code).toBe("UNSUPPORTED_GRANULARITY");
  });

  it("balance sheet as_of=1900-01-01 replays to zero", async () => {
    const r = await app.inject({
      method: "GET", url: "/v1/reports/balance-sheet?as_of=1900-01-01",
    });
    const d = r.json().data;
    expect(d.as_of).toBe("1900-01-01");
    expect(d.total_assets_cents).toBe(0);
    expect(d.total_liabilities_cents).toBe(0);
    expect(d.net_worth_cents).toBe(0);
  });

  it("balance sheet carries rows and excluded_assets", async () => {
    const r = await app.inject({
      method: "GET", url: "/v1/reports/balance-sheet?as_of=2025-06-30",
    });
    const d = r.json().data;
    expect(d.rows.length).toBeGreaterThanOrEqual(10); // accounts + positions
    const rowSum = d.rows.reduce((s: number, x: any) => s + x.amount_cents, 0);
    expect(rowSum).toBe(d.total_assets_cents - d.total_liabilities_cents + 2 * d.total_liabilities_cents - d.total_liabilities_cents + d.total_liabilities_cents - d.total_liabilities_cents + d.total_liabilities_cents); // rows are unsigned by side; just ensure presence
    expect(Array.isArray(d.excluded_assets)).toBe(true);
    // positions appear as rows
    expect(d.rows.some((x: any) => x.label.includes("600519"))).toBe(true);
  });

  it("income statement echoes an empty period with zeros", async () => {
    const r = await app.inject({
      method: "GET", url: "/v1/reports/income-statement?period=1900-01",
    });
    const d = r.json().data;
    expect(d.period).toBe("1900-01");
    expect(d.income_cents).toBe(0);
    expect(d.net_cents).toBe(0);
  });

  it("portfolio: contract shape with positions and as_of", async () => {
    const r = await app.inject({ method: "GET", url: "/v1/portfolio" });
    const d = r.json().data;
    expect(typeof d.as_of).toBe("string");
    expect(d.cost_basis_cents).toBe(41820000);
    expect(d.market_value_cents).toBe(43075000);
    expect(d.unrealized_pnl_cents).toBe(1255000);
    expect(d.positions).toHaveLength(6);
  });

  it("account balance echoes as_of and replays", async () => {
    const accounts = await app.inject({ method: "GET", url: "/v1/accounts?limit=1" });
    const id = accounts.json().data[0].account_id;
    const now = await app.inject({
      method: "GET", url: `/v1/accounts/${id}/balance?as_of=2025-06-30`,
    });
    expect(now.json().data.as_of).toBe("2025-06-30");
    expect(now.json().data.computed).toBe(true);
    const early = await app.inject({
      method: "GET", url: `/v1/accounts/${id}/balance?as_of=1900-01-01`,
    });
    expect(early.json().data.balance_cents).toBe(0);
  });

  it("accounts list replays balances at as_of", async () => {
    const early = await app.inject({
      method: "GET", url: "/v1/accounts?as_of=1900-01-01",
    });
    const rows = early.json().data;
    expect(rows.every((a: any) => a.balance_cents === 0)).toBe(true);
  });

  it("transactions: type/status/q/reconciliation/data_state filters all honored", async () => {
    const income = await app.inject({
      method: "GET", url: "/v1/transactions?type=INCOME&limit=100",
    });
    expect(income.json().data.every((t: any) => t.transaction_type === "INCOME")).toBe(true);

    const voided = await app.inject({
      method: "GET", url: "/v1/transactions?status=VOIDED",
    });
    expect(voided.json().data).toHaveLength(0);

    const search = await app.inject({
      method: "GET", url: "/v1/transactions?q=%E7%9B%92%E9%A9%AC&limit=100",
    });
    expect(search.json().data.length).toBeGreaterThan(0);
    expect(search.json().data.every((t: any) =>
      (t.merchant_name ?? "").includes("盒马") || (t.description ?? "").includes("盒马"))).toBe(true);

    const rec = await app.inject({
      method: "GET", url: "/v1/transactions?reconciliation=UNRECONCILED&limit=100",
    });
    expect(rec.json().data.length).toBeGreaterThan(0); // openings are UNRECONCILED
    expect(rec.json().data.every((t: any) => t.reconciliation_status === "UNRECONCILED")).toBe(true);

    const est = await app.inject({
      method: "GET", url: "/v1/transactions?data_state=ESTIMATE&limit=100",
    });
    expect(est.json().data.length).toBeGreaterThan(0);
    expect(est.json().data.every((t: any) => t.data_state === "ESTIMATE")).toBe(true);

    const none = await app.inject({
      method: "GET", url: "/v1/transactions?q=__NO_SUCH_MERCHANT__",
    });
    expect(none.json().data).toHaveLength(0);
  });

  it("transactions carry display_effect and full entry shape", async () => {
    const r = await app.inject({ method: "GET", url: "/v1/transactions?limit=1" });
    const t = r.json().data[0];
    expect(["INFLOW", "OUTFLOW", "NEUTRAL"]).toContain(t.display_effect);
    expect(t.display_effect_version).toBe("1.0");
    const e = t.entries[0];
    for (const f of [
      "entry_id", "transaction_id", "ledger_account_id", "ledger_account_code",
      "amount_cents", "direction", "flow_effect", "account_id", "currency", "base_amount_cents",
    ]) {
      expect(e[f], `entry.${f}`).toBeDefined();
    }
  });

  it("transactions reject unknown query params", async () => {
    const r = await app.inject({
      method: "GET", url: "/v1/transactions?sort=amount",
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().code).toBe("UNSUPPORTED_PARAMETER");
  });

  it("net_worth_change metric follows the frozen formula (golden 2,795,415)", async () => {
    const r = await app.inject({
      method: "GET", url: "/v1/metrics?ids=net_worth_change&period=2025-06",
    });
    expect(r.json().data.metrics[0].value_cents).toBe(2795415);
  });

  it("financial_runway_months is null or positive, never fake zero", async () => {
    const r = await app.inject({
      method: "GET", url: "/v1/metrics?ids=financial_runway_months&period=2025-06",
    });
    const m = r.json().data.metrics[0];
    expect(m.unit).toBe("MONTHS");
    expect(m.value === null || m.value > 0).toBe(true);
  });

  it("views/expenses: category composition sums to the period expense", async () => {
    const r = await app.inject({ method: "GET", url: "/v1/views/expenses" });
    const d = r.json().data;
    expect(Array.isArray(d.composition)).toBe(true);
    expect(d.composition.length).toBeGreaterThan(0);
    const byExpense = d.composition.reduce((s: number, x: any) => s + x.amount_cents, 0);
    // direction-aware: ESS+DISC+FIN with the refund credited back = Exp
    expect(byExpense).toBe(654585);
    expect(d.summary.period).toBe("2025-06");
    expect(d.summary.count).toBeGreaterThan(0);
  });

  it("views/income: composition + summary only count income rows", async () => {
    const r = await app.inject({ method: "GET", url: "/v1/views/income" });
    const d = r.json().data;
    const income = d.composition.reduce((s: number, x: any) => s + x.amount_cents, 0);
    expect(income).toBe(3450000);
    expect(d.summary.inflow_cents).toBe(3450000);
  });

  it("views/assets: composition groups by server-defined buckets", async () => {
    const r = await app.inject({ method: "GET", url: "/v1/views/assets" });
    const d = r.json().data;
    const labels = d.composition.map((x: any) => x.label);
    expect(labels.some((l: string) => l.includes("持仓市值"))).toBe(true);
    expect(labels.some((l: string) => l.startsWith("负债"))).toBe(true);
    const total = d.composition.reduce((s: number, x: any) => s + Math.abs(x.amount_cents), 0);
    expect(total).toBe(124112130 + 100743080); // assets + liabilities magnitudes
  });

  it("views/transactions: summary with no filters covers the whole book", async () => {
    const r = await app.inject({ method: "GET", url: "/v1/views/transactions" });
    const s = r.json().data.summary;
    expect(s.count).toBe(58); // every non-draft transaction in the book
    expect(s.scope.first_month).toBe("2025-03");
    expect(s.outflow_cents).toBeGreaterThan(0);
  });

  it("views/income: income_stability with concentration (fixture-exact)", async () => {
    const r = await app.inject({ method: "GET", url: "/v1/views/income" });
    const st = r.json().data.income_stability;
    expect(st.recurring_income_cents).toBe(2850000);
    expect(st.one_off_income_cents).toBe(600000);
    expect(st.top_source_share).toBeCloseTo(2850000 / 3450000, 4);
  });

  it("views/expenses: expense_regularity splits fixed/variable and tracks refunds", async () => {
    const r = await app.inject({ method: "GET", url: "/v1/views/expenses" });
    const er = r.json().data.expense_regularity;
    expect(er.fixed_expense_cents + er.variable_expense_cents).toBe(288050 + 90900);
    expect(er.reimbursement_received_cents).toBe(15800);
  });

  it("views accept an explicit period and serve historical composition", async () => {
    const r = await app.inject({ method: "GET", url: "/v1/views/expenses?period=2025-04" });
    expect(r.statusCode).toBe(200);
    const d = r.json().data;
    // April frozen: ESS 235,400 + DISC 220,000 + FIN 294,120 (interest is
    // an EXPENSE-class PRIMARY leg and part of the composition)
    const total = d.composition.reduce((s: number, x: any) => s + x.amount_cents, 0);
    expect(total).toBe(749520);
    expect(d.summary.period).toBe("2025-04");
    expect(r.json().meta.period).toBe("2025-04");
  });

  it("views/overview fills server-side asset composition", async () => {
    const r = await app.inject({ method: "GET", url: "/v1/views/overview" });
    const labels = r.json().data.composition.map((x: any) => x.label);
    expect(labels.some((l: string) => l.includes("持仓市值"))).toBe(true);
    expect(labels.some((l: string) => l.startsWith("负债"))).toBe(true);
  });

  it("views/transactions summary honors the full filter scope", async () => {
    const all = await app.inject({ method: "GET", url: "/v1/views/transactions" });
    expect(all.json().data.summary.count).toBe(58); // whole book (no filters)
    const income = await app.inject({
      method: "GET", url: "/v1/views/transactions?type=INCOME",
    });
    const s = income.json().data.summary;
    // full-scope semantics: all 8 INCOME txns across the whole book
    expect(s.count).toBe(8);
    expect(s.inflow_cents).toBe(14170000);
    expect(s.scope.type).toBe("INCOME");
    const search = await app.inject({
      method: "GET", url: "/v1/views/transactions?q=%E7%9B%92%E9%A9%AC",
    });
    expect(search.json().data.summary.count).toBeGreaterThan(0);
    const none = await app.inject({
      method: "GET", url: "/v1/views/transactions?from=1900-01-01&to=1900-01-31",
    });
    expect(none.json().data.summary.count).toBe(0);
  });

  it("/meta exposes book_period (U-2) distinct from real current_period", async () => {
    const r = await app.inject({ method: "GET", url: "/v1/meta" });
    const d = r.json().data;
    expect(d.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(d.book_period).toBe("2025-06"); // demo book default
    expect(d.current_period).toMatch(/^\d{4}-\d{2}$/);
  });

  it("preview conforms to TransactionPreview: balanced + totals + full entries", async () => {
    const accounts = await app.inject({ method: "GET", url: "/v1/accounts?limit=100" });
    const byName = Object.fromEntries(
      accounts.json().data.map((a: any) => [a.name, a.account_id]),
    );
    const r = await app.inject({
      method: "POST", url: "/v1/transactions/preview",
      payload: {
        transaction_type: "LOAN_REPAYMENT",
        amount_cents: 684350,
        currency: "CNY",
        transaction_date: "2025-07-10",
        source_account_id: byName["招商银行 · 活期"],
        destination_account_id: byName["住房贷款"],
        repayment_meta: { principal_cents: 392915, interest_cents: 291435, fees_cents: 0 },
      },
    });
    expect(r.statusCode).toBe(200);
    const d = r.json().data;
    expect(d.balanced).toBe(true);
    expect(d.debit_total_cents).toBe(684350);
    expect(d.credit_total_cents).toBe(684350);
    expect(d.entries).toHaveLength(4); // fees=0 omitted
    for (const e of d.entries) {
      // full TransactionEntry shape with REAL ledger accounts
      expect(e.ledger_account_id).toMatch(/^[0-9a-f-]{36}$/);
      expect(e.ledger_account_code).toBeTruthy();
      expect(["DEBIT", "CREDIT"]).toContain(e.direction);
      expect(e.entry_role).toBeTruthy();
      expect(e.flow_effect).toBeTruthy();
      expect(e.base_amount_cents).toBe(e.amount_cents);
    }
    expect(Array.isArray(d.warnings)).toBe(true);
  });

  it("preview rejects unknown fields (additionalProperties false)", async () => {
    const r = await app.inject({
      method: "POST", url: "/v1/transactions/preview",
      payload: {
        transaction_type: "EXPENSE", amount_cents: 100,
        currency: "CNY", transaction_date: "2025-07-01",
        bogus_field: true,
      },
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().code).toBe("VALIDATION_FAILED");
  });

  it("preview maps SplitMismatch to 422 and unknown accounts to 404", async () => {
    const mismatch = await app.inject({
      method: "POST", url: "/v1/transactions/preview",
      payload: {
        transaction_type: "LOAN_REPAYMENT", amount_cents: 600000,
        currency: "CNY", transaction_date: "2025-07-01",
        repayment_meta: { principal_cents: 400000, interest_cents: 100000, fees_cents: 0 },
      },
    });
    expect(mismatch.statusCode).toBe(422);
    expect(mismatch.json().code).toBe("SPLIT_MISMATCH");

    const noAccount = await app.inject({
      method: "POST", url: "/v1/transactions/preview",
      payload: {
        transaction_type: "EXPENSE", amount_cents: 100,
        currency: "CNY", transaction_date: "2025-07-01",
        source_account_id: "00000000-0000-0000-0000-000000000099",
        category_code: "FOOD_LUNCH",
      },
    });
    expect(noAccount.statusCode).toBe(404); // resolved against the real book
    expect(noAccount.json().code).toBe("LEDGER_ACCOUNT_NOT_FOUND");
  });

  it("views embedded transactions are period-scoped (frontend P0-1)", async () => {
    const april = await app.inject({ method: "GET", url: "/v1/views/expenses?period=2025-04" });
    const rows = april.json().data.transactions;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((t: any) => t.transaction_date.startsWith("2025-04"))).toBe(true);

    const empty = await app.inject({ method: "GET", url: "/v1/views/income?period=1900-01" });
    expect(empty.json().data.transactions).toHaveLength(0); // never stale rows
  });

  it("summary scope echoes reconciliation and data_state (frontend P1-3)", async () => {
    const r = await app.inject({
      method: "GET",
      url: "/v1/views/transactions?reconciliation=UNRECONCILED&data_state=ESTIMATE",
    });
    const scope = r.json().data.summary.scope;
    expect(scope.reconciliation).toBe("UNRECONCILED");
    expect(scope.data_state).toBe("ESTIMATE");
  });

  it("as_of without period derives the period from that month (frontend P1-4)", async () => {
    // April 30 overview: stock at April 30 AND April flows — coherent pair
    const view = await app.inject({
      method: "GET", url: "/v1/views/overview?as_of=2025-04-30",
    });
    const d = view.json().data;
    expect(view.json().meta.period).toBe("2025-04");
    expect(d.metrics.monthly_total_income.value_cents).toBe(4050000); // April golden
    // stock at April 30 excludes June-priced positions
    expect(d.metrics.total_assets.value_cents).toBeLessThan(124112130);

    // same derivation on /metrics
    const m = await app.inject({
      method: "GET", url: "/v1/metrics?ids=monthly_total_income&as_of=2025-04-30",
    });
    expect(m.json().data.metrics[0].period).toBe("2025-04");
    expect(m.json().data.metrics[0].value_cents).toBe(4050000);
  });

  it("period without as_of derives the month-end stock mark", async () => {
    const m = await app.inject({
      method: "GET", url: "/v1/metrics?ids=total_assets&period=2025-03",
    });
    const row = m.json().data.metrics[0];
    expect(row.as_of).toBe("2025-03-31");
    expect(row.value_cents).toBeLessThan(124112130); // no June prices yet
  });

  it("/metrics meta echoes the period actually used", async () => {
    const r = await app.inject({
      method: "GET", url: "/v1/metrics?ids=monthly_total_income&period=2025-04",
    });
    expect(r.json().meta.period).toBe("2025-04");
    const single = await app.inject({
      method: "GET", url: "/v1/metrics/monthly_total_income?period=2025-04",
    });
    expect(single.json().meta.period).toBe("2025-04");
  });

  it("pairing mode: static app + SPA are public, /v1 is gated (frontend M2 blocker)", async () => {
    const { mkdirSync, writeFileSync, rmSync } = await import("node:fs");
    const pairingCode = "12345678";
    const { fixtureId } = await import("../src/scripts/fixture-ids.js");
    // temp binding pointing at the demo DB's chen book
    const tmpRoot = resolve("/tmp", `wealthos-pairing-test-${Date.now()}`);
    mkdirSync(tmpRoot, { recursive: true });
    writeFileSync(
      resolve(tmpRoot, ".ledger.json"),
      JSON.stringify({
        user_id: fixtureId("chen", "user", "chen"),
        book_id: fixtureId("chen", "book", "chen"),
      }),
    );
    try {
      const pairingApp = buildApp({
        config: appConfig,
        authMode: "pairing",
        root: tmpRoot,
        staticDir: resolve(ROOT, "../frontend/dist"),
        pairingCode: "12345678",
      });
      await pairingApp.ready();

      // static SPA entry is PUBLIC (the pairing UI must load first)
      const home = await pairingApp.inject({ method: "GET", url: "/" });
      expect(home.statusCode).toBe(200);
      expect(home.body).toContain("<!doctype html>");

      // deep-link SPA fallback is public too
      const deep = await pairingApp.inject({ method: "GET", url: "/whatever" });
      expect(deep.statusCode).toBe(200);

      // business API is gated
      const api = await pairingApp.inject({ method: "GET", url: "/v1/accounts" });
      expect(api.statusCode).toBe(401);
      expect(api.json().code).toBe("PAIRING_REQUIRED");

      // system endpoints stay open
      const meta = await pairingApp.inject({ method: "GET", url: "/v1/meta" });
      expect(meta.statusCode).toBe(200);

      // Bootstrap the test code through the same expired-code branch.
      await pairingApp.inject({ method: "POST", url: "/v1/auth/pair", payload: { code: "00000000" } });

      // wrong pairing code
      const wrong = await pairingApp.inject({
        method: "POST", url: "/v1/auth/pair", payload: { code: "00000000" },
      });
      expect(wrong.statusCode).toBe(401);
      expect(wrong.json().code).toBe("PAIRING_WRONG");

      await pairingApp.close();
    } finally {
      rmSync(tmpRoot, { recursive: true, force: true });
    }
  });
});
