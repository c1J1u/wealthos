// WealthOS Phase 1 mock server.
// Serves the OpenAPI contract shape from normalized chen fixtures so the
// frontend develops against contract-truthful responses before the real
// backend exists. It shares the backend's pure fixture normalizer, but its
// simplified report projections are synthetic test data, not Golden proof.
import http from "node:http";
import path from "node:path";
import url from "node:url";
import crypto from "node:crypto";
import { loadNormalizedFixture, normalizeFixture, computeMetrics, uuid } from "./normalize.mjs";

const root = path.dirname(url.fileURLToPath(import.meta.url));
const repoRoot = path.resolve(root, "../..");
const defaultPersona = process.env.MOCK_PERSONA ?? "chen";
const datasets = new Map();
for (const persona of ["chen", "me"]) {
  const norm = normalizeFixture(loadNormalizedFixture(persona), persona);
  datasets.set(persona, { persona, norm, metrics: computeMetrics(norm, "2025-06") });
}
const PERIOD = "2025-06";
const TODAY = "2025-06-15";

const rid = () => crypto.randomUUID();
const meta = (extra = {}) => ({
  request_id: rid(),
  as_of: TODAY,
  data_state: "ACTUAL",
  partial: false,
  missing_count: 0,
  ...extra,
});

function paginate(items, q, keyFn) {
  const limit = Math.min(Number(q.get("limit") ?? 50), 200);
  const cursor = q.get("cursor");
  let start = 0;
  if (cursor) {
    const idx = items.findIndex((it) => keyFn(it) === cursor);
    start = idx >= 0 ? idx + 1 : 0;
  }
  const page = items.slice(start, start + limit);
  const next = start + limit < items.length ? keyFn(page[page.length - 1]) : null;
  return { page, next };
}

const monthSeries = (metricId, query, norm) => {
  const from = query.get("from")?.slice(0, 7);
  const to = query.get("to")?.slice(0, 7);
  const months = [...new Set(norm.transactions.map((transaction) => transaction.transaction_date.slice(0, 7)))].sort()
    .filter((period) => (!from || period >= from) && (!to || period <= to));
  const points = months.map((period) => {
    const metric = computeMetrics(norm, period).find((item) => item.metric_id === metricId);
    return { period, value: metric?.value ?? null, value_cents: metric?.value_cents ?? null, data_state: "ACTUAL" };
  });
  return { metric_id: metricId, granularity: "month", points };
};

const routes = {
  "GET /health": () => ({ status: "ok", version: "mock-1.0.0" }),
  "GET /meta": () => ({
    data: {
      server_time: `${TODAY}T09:00:00+08:00`,
      timezone: "Asia/Shanghai",
      base_currency: "CNY",
      schema_version: "1.0",
      min_client_version: "0.1.0",
      today: TODAY,
      current_period: PERIOD,
      book_period: PERIOD,
      capabilities: ["ledger.read", "metrics.read", "reports.read", "transactions.preview"],
    },
    meta: meta(),
  }),
  "GET /me": (_q, _req, { norm, persona }) => ({
    data: {
      user_id: uuid(`user:${persona}`),
      display_name: norm.profile.display_name,
      book_id: norm.bookId,
      book_name: `${norm.profile.display_name} 的账本`,
      roles: ["owner"],
      scopes: ["ledger.read", "metrics.read", "reports.read"],
    },
    meta: meta(),
  }),
  "GET /books": (_q, _req, { norm }) => ({
    data: [{ book_id: norm.bookId, name: `${norm.profile.display_name} 的账本`, base_currency: "CNY", fiscal_start_month: 1, status: "ACTIVE" }],
    meta: meta(),
  }),
  "GET /bootstrap": (_q, _req, { norm, metrics }) => ({
    data: {
      profile: norm.profile,
      accounts: norm.accounts,
      categories: norm.categories,
      transactions: norm.transactions.slice(0, 50),
      instruments: norm.instruments,
      positions: norm.positions,
      assets: norm.assets,
      asset_valuations: norm.assetValuations,
      snapshots: norm.snapshots,
      metrics,
    },
    meta: meta(),
  }),
  "GET /accounts": (q, _req, { norm }) => {
    const { page, next } = paginate(norm.accounts, q, (a) => a.account_id);
    return { data: page, meta: meta({ next_cursor: next }) };
  },
  "GET /transactions": (q, _req, { norm }) => {
    let items = [...norm.transactions].sort((a, b) => b.transaction_date.localeCompare(a.transaction_date));
    const from = q.get("from");
    const to = q.get("to");
    const type = q.get("type");
    const account = q.get("account_id");
    const cat = q.get("category_code");
    const search = q.get("q")?.toLowerCase();
    if (from) items = items.filter((t) => t.transaction_date >= from);
    if (to) items = items.filter((t) => t.transaction_date <= to);
    if (type) items = items.filter((t) => t.transaction_type === type);
    if (account) items = items.filter((t) => t.entries.some((e) => e.account_id === account));
    if (cat) items = items.filter((t) => t.category_code === cat);
    const dataState = q.get("data_state");
    if (dataState) items = items.filter((t) => t.data_state === dataState);
    const status = q.get("status");
    const recon = q.get("reconciliation");
    if (status) items = items.filter((t) => t.status === status);
    if (recon) items = items.filter((t) => t.reconciliation_status === recon);
    if (search) items = items.filter((t) => (t.merchant_name ?? "").toLowerCase().includes(search) || (t.description ?? "").toLowerCase().includes(search));
    const { page, next } = paginate(items, q, (t) => t.transaction_id);
    return { data: page, meta: meta({ next_cursor: next }) };
  },
  "GET /categories": (_q, _req, { norm }) => ({ data: norm.categories, meta: meta() }),
  "GET /assets": (_q, _req, { norm }) => ({ data: norm.assets, meta: meta() }),
  "GET /instruments": (_q, _req, { norm }) => ({ data: norm.instruments, meta: meta() }),
  "GET /positions": (_q, _req, { norm }) => ({ data: norm.positions, meta: meta() }),
  "GET /portfolio": (_q, _req, { norm }) => ({
    data: {
      as_of: TODAY,
      market_value_cents: norm.positions.reduce((s, p) => s + (p.market_value_cents ?? 0), 0),
      cost_basis_cents: norm.positions.reduce((s, p) => s + p.total_cost_basis_cents, 0),
      unrealized_pnl_cents: norm.positions.reduce((s, p) => s + (p.unrealized_pnl_cents ?? 0), 0),
      realized_pnl_cents: 0,
      positions: norm.positions,
    },
    meta: meta(),
  }),
  "GET /metrics": (q, _req, { norm }) => {
    const period = q.get("period") ?? PERIOD;
    const rows = computeMetrics(norm, period, q.get("as_of") ?? `${period}-15`);
    const ids = q.get("ids")?.split(",");
    return { data: { metrics: ids ? rows.filter((m) => ids.includes(m.metric_id)) : rows }, meta: meta() };
  },
  "GET /snapshots": (_q, _req, { norm }) => ({ data: norm.snapshots, meta: meta({ data_state: "ESTIMATE", partial: true, missing_count: norm.snapshots.length }) }),
  "GET /reports/balance-sheet": (q, _req, { norm }) => {
    const asOf = q.get("as_of") ?? TODAY;
    const earliest = norm.transactions.map((t) => t.transaction_date).sort()[0];
    if (earliest && asOf < earliest) return { data: { as_of: asOf, total_assets_cents: 0, total_liabilities_cents: 0, net_worth_cents: 0, rows: [], excluded_assets: [] }, meta: meta() };
    const current = computeMetrics(norm, PERIOD);
    const totalAssets = current.find((m) => m.metric_id === "total_assets").value_cents;
    const totalLiabs = current.find((m) => m.metric_id === "total_liabilities").value_cents;
    const rows = norm.accounts.map((a) => ({ label: a.name, account_id: a.account_id, amount_cents: a.balance_cents, data_state: a.data_state }));
    const positionsValue = norm.positions.reduce((sum, p) => sum + (p.market_value_cents ?? 0), 0);
    rows.push({ label: "投资持仓市值", account_id: null, amount_cents: positionsValue, data_state: "ACTUAL" });
    return { data: { as_of: asOf, total_assets_cents: totalAssets, total_liabilities_cents: totalLiabs, net_worth_cents: totalAssets - totalLiabs, rows, excluded_assets: [] }, meta: meta() };
  },
  "GET /reports/income-statement": (q, _req, { norm }) => {
    const period = q.get("period") ?? PERIOD;
    const periodMetrics = computeMetrics(norm, period);
    const g = (id) => periodMetrics.find((m) => m.metric_id === id).value_cents ?? 0;
    const income = g("monthly_total_income");
    const expense = g("monthly_total_expense");
    const rows = norm.categories
      .filter((c) => norm.transactions.some((t) => t.category_code === c.category_code && t.transaction_date.startsWith(period)))
      .map((c) => ({
        label: c.name_zh,
        account_id: null,
        amount_cents: norm.transactions.filter((t) => t.category_code === c.category_code && t.transaction_date.startsWith(period)).reduce((s, t) => s + t.amount_cents, 0),
        data_state: "ACTUAL",
      }));
    return {
      data: {
        period,
        income_cents: income,
        essential_cents: g("essential_expense"),
        discretionary_cents: g("discretionary_expense"),
        financial_cost_cents: g("financial_cost"),
        refund_reversal_cents: g("refund_reversal"),
        expense_cents: expense,
        net_cents: income - expense,
        rows,
      },
      meta: meta(),
    };
  },
  "GET /reports/cash-flow": (q, _req, { norm }) => {
    const from = q.get("from") ?? `${PERIOD}-01`;
    const to = q.get("to") ?? `${PERIOD}-30`;
    const periodMetrics = computeMetrics(norm, from.slice(0, 7));
    const inPeriod = from.slice(0, 7) === to.slice(0, 7);
    const inflow = inPeriod ? periodMetrics.find((m) => m.metric_id === "monthly_total_income").value_cents : 0;
    const outflow = inPeriod ? periodMetrics.find((m) => m.metric_id === "monthly_total_expense").value_cents : 0;
    return {
      data: {
        from_date: from,
        to_date: to,
        operating_cents: inflow - outflow,
        investing_cents: 0,
        financing_cents: 0,
        net_cents: inflow - outflow,
        note: "合并口径：内部转账与资产交换已抵消；公积金付租不计入经营现金流。",
      },
      meta: meta(),
    };
  },
  "GET /data-quality": (_q, _req, { norm }) => ({
    data: {
      run_at: `${TODAY}T09:00:00+08:00`,
      pass: true,
      checks: [
        { check_id: "entries-balanced", pass: true, detail: "所有已入账交易借贷平衡" },
        { check_id: "null-funding-legs", pass: true, detail: "23 条 null 资金腿已按 N-01..N-12 规范化" },
        { check_id: "uncategorized", pass: true, detail: "0 笔未分类交易" },
      ],
      fixture_normalization: { persona: norm.persona, funding_legs_fixed: 23 },
    },
    meta: meta(),
  }),
  "GET /audit-logs": () => ({ data: [], meta: meta() }),
};

function handleView(page, query, { norm, metrics }) {
  const period = query.get("period") ?? PERIOD;
  const type = page === "income" ? "INCOME" : page === "expenses" ? "EXPENSE" : null;
  const selected = type ? norm.transactions.filter((transaction) => transaction.transaction_type === type && transaction.transaction_date.startsWith(period)) : [];
  const sum = (items) => items.reduce((total, transaction) => total + transaction.amount_cents, 0);
  const groups = new Map();
  for (const transaction of selected) {
    const label = norm.categories.find((category) => category.category_code === transaction.category_code)?.name_zh ?? "未分类";
    groups.set(label, (groups.get(label) ?? 0) + transaction.amount_cents);
  }
  const composition = page === "overview" ? norm.accounts.filter((account) => account.include_in_net_worth).map((account) => ({ label: account.name, amount_cents: account.balance_cents, share: null, data_state: account.data_state ?? "ACTUAL" }))
    : [...groups].map(([label, amount_cents]) => ({ label, amount_cents, share: sum(selected) ? amount_cents / sum(selected) : null, data_state: "ESTIMATE" }));
  const stability = {
    period,
    recurring_income_cents: type === "INCOME" ? Math.round(sum(selected) * 0.8) : undefined,
    one_off_income_cents: type === "INCOME" ? sum(selected) - Math.round(sum(selected) * 0.8) : undefined,
    source_count: type === "INCOME" ? groups.size : undefined,
    top_source_label: type === "INCOME" ? [...groups].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null : undefined,
    top_source_amount_cents: type === "INCOME" ? Math.max(0, ...groups.values()) : undefined,
    top_source_share: type === "INCOME" && sum(selected) ? Math.max(0, ...groups.values()) / sum(selected) : null,
    fixed_expense_cents: type === "EXPENSE" ? Math.round(sum(selected) * 0.4) : undefined,
    variable_expense_cents: type === "EXPENSE" ? sum(selected) - Math.round(sum(selected) * 0.4) : undefined,
    reimbursable_expense_cents: 0,
    reimbursement_received_cents: 0,
  };
  return {
    data: {
      page,
      metrics: Object.fromEntries(metrics.map((m) => [m.metric_id, m])),
      accounts: norm.accounts,
      transactions: norm.transactions.slice(0, 20),
      categories: norm.categories,
      assets: norm.assets,
      positions: norm.positions,
      snapshots: norm.snapshots,
      composition,
      summary: type ? { count: selected.length, inflow_cents: type === "INCOME" ? sum(selected) : 0, outflow_cents: type === "EXPENSE" ? sum(selected) : 0, period } : page === "transactions" ? {
        count: norm.transactions.filter((transaction) => (!query.get("type") || transaction.transaction_type === query.get("type")) && (!query.get("from") || transaction.transaction_date >= query.get("from")) && (!query.get("to") || transaction.transaction_date <= query.get("to"))).length,
        inflow_cents: norm.transactions.filter((transaction) => transaction.display_effect === "INFLOW").reduce((total, transaction) => total + transaction.amount_cents, 0),
        outflow_cents: norm.transactions.filter((transaction) => transaction.display_effect === "OUTFLOW").reduce((total, transaction) => total + transaction.amount_cents, 0),
        period: null,
        scope: { from: query.get("from"), to: query.get("to"), type: query.get("type"), account_id: query.get("account_id"), category_code: query.get("category_code"), status: query.get("status"), reconciliation: query.get("reconciliation"), data_state: query.get("data_state"), q: query.get("q") },
      } : undefined,
      income_stability: page === "income" ? stability : undefined,
      expense_regularity: page === "expenses" ? stability : undefined,
    },
    meta: meta({ period }),
  };
}

const server = http.createServer((req, res) => {
  const u = new URL(req.url, "http://localhost");
  const pathName = u.pathname.replace(/^\/v1/, "");
  const persona = u.searchParams.get("demo_persona") ?? defaultPersona;
  const dataset = datasets.get(persona);
  if (!dataset) return sendProblem(res, 400, "VALIDATION_FAILED", "Unknown demo persona");
  const { norm, metrics } = dataset;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("x-request-id", rid());

  let match = routes[`${req.method} ${pathName}`];
  let body;
  if (!match) {
    const viewMatch = pathName.match(/^\/views\/([a-z]+)$/);
    const txnMatch = pathName.match(/^\/transactions\/([0-9a-f-]{36})(\/entries)?$/);
    const acctMatch = pathName.match(/^\/accounts\/([0-9a-f-]{36})(\/balance|\/entries)?$/);
    const metricMatch = pathName.match(/^\/metrics\/([a-z_]+)$/);
    const assetValuationMatch = pathName.match(/^\/assets\/([0-9a-f-]{36})\/valuations$/);
    if (req.method === "GET" && viewMatch) body = handleView(viewMatch[1], u.searchParams, { norm, metrics });
    else if (req.method === "GET" && txnMatch) {
      const txn = norm.transactions.find((t) => t.transaction_id === txnMatch[1]);
      if (!txn) return sendProblem(res, 404, "NOT_FOUND", "Transaction not found");
      body = txnMatch[2] ? { data: txn.entries, meta: meta() } : { data: txn, meta: meta() };
    } else if (req.method === "GET" && assetValuationMatch) {
      const asset = norm.assets.find((item) => item.asset_id === assetValuationMatch[1]);
      if (!asset) return sendProblem(res, 404, "NOT_FOUND", "Asset not found");
      body = { data: norm.assetValuations.filter((item) => item.asset_id === asset.asset_id), meta: meta({ data_state: "ESTIMATE" }) };
    } else if (req.method === "GET" && acctMatch) {
      const acct = norm.accounts.find((a) => a.account_id === acctMatch[1]);
      if (!acct) return sendProblem(res, 404, "NOT_FOUND", "Account not found");
      if (acctMatch[2] === "/balance") {
        body = { data: { account_id: acct.account_id, as_of: TODAY, debit_total_cents: acct.balance_cents, credit_total_cents: 0, balance_cents: acct.balance_cents, normal_side: acct.normal_side, available_balance_cents: acct.available_balance_cents, frozen_amount_cents: acct.frozen_amount_cents, computed: true }, meta: meta() };
      } else if (acctMatch[2] === "/entries") {
        const entries = norm.transactions.flatMap((t) => t.entries).filter((e) => e.account_id === acct.account_id);
        body = { data: entries, meta: meta({ next_cursor: null }) };
      } else body = { data: acct, meta: meta() };
    } else if (req.method === "GET" && metricMatch) {
      const m = metrics.find((x) => x.metric_id === metricMatch[1]);
      body = m ? { data: m, meta: meta() } : undefined;
      if (!body) return sendProblem(res, 404, "NOT_FOUND", "Metric not found");
    } else if (req.method === "GET" && pathName === "/analytics/series") {
      body = { data: monthSeries(u.searchParams.get("metric") ?? "net_worth", u.searchParams, norm), meta: meta() };
    } else if (req.method === "POST" && pathName === "/transactions/preview") {
      return sendProblem(res, 422, "VALIDATION_FAILED", "Preview is not implemented in the mock server");
    }
  } else {
    body = match(u.searchParams, req, { norm, metrics, persona });
  }

  if (!body) return sendProblem(res, 404, "NOT_FOUND", `No mock route for ${req.method} ${pathName}`);
  res.writeHead(200);
  res.end(JSON.stringify(body));
});

function sendProblem(res, status, code, title) {
  res.writeHead(status);
  res.end(JSON.stringify({ type: "about:blank", title, status, code, request_id: rid() }));
}

const port = Number(process.env.MOCK_PORT ?? 3100);
server.listen(port, "127.0.0.1", () => {
  console.log(`WealthOS mock API (${defaultPersona}, chen/me request-scoped) listening on http://127.0.0.1:${port}/v1`);
});
