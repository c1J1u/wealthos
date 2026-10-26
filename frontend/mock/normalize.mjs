// Map the backend's normalized fixtures to OpenAPI-shaped mock DTOs.
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import path from "node:path";
import url from "node:url";

export function uuid(seed) {
  const h = crypto.createHash("md5").update(String(seed)).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

const repoRoot = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "../..");

function liquidityFor(subtype) {
  return ({
    BANK_CHECKING: "INSTANT", CASH_WALLET: "INSTANT", ALIPAY_BALANCE: "INSTANT",
    WECHAT_BALANCE: "INSTANT", DIGITAL_WALLET: "INSTANT", BANK_SAVINGS: "HIGH",
    BROKERAGE: "HIGH", BANK_FIXED_DEPOSIT: "TERM", HOUSING_PROVIDENT_FUND: "TERM",
    CREDIT_CARD: "INSTANT", MORTGAGE: "ILLIQUID", CREDIT_CARD_INSTALLMENT: "INSTANT",
    RECEIVABLE: "LOW",
  })[subtype] ?? "LOW";
}

function assetClassFor(type) {
  return ({ "股票": "EQUITY", "ETF": "ETF", "债券基金": "FUND", "基金": "FUND", "现金等价": "CASH_EQUIVALENT" })[type] ?? "OTHER";
}

export function loadNormalizedFixture(persona) {
  const tsx = path.join(repoRoot, "backend/node_modules/.bin/tsx");
  const adapter = path.join(repoRoot, "frontend/mock/normalized-fixture.mjs");
  return JSON.parse(execFileSync(tsx, [adapter, persona], { cwd: repoRoot, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }));
}

export function normalizeFixture({ fixture, entries, bookId }, persona) {
  const accountId = (a) => uuid(`acct:${persona}:${a}`);
  const txnId = (t) => uuid(`txn:${persona}:${t}`);

  const accounts = fixture.accounts.map((a) => ({
    account_id: accountId(a.account_id),
    name: a.account_name,
    type: a.account_type === "LOAN" ? "CREDIT" : a.account_type,
    subtype: a.account_subtype ?? "OTHER",
    institution_name: a.institution_name ?? null,
    currency: a.currency ?? "CNY",
    normal_side: a.normal_side,
    include_in_net_worth: a.include_in_net_worth !== false,
    is_restricted: a.account_subtype === "HOUSING_PROVIDENT_FUND",
    liquidity_level: liquidityFor(a.account_subtype),
    status: a.account_status ?? "ACTIVE",
    balance_cents: a.balance_cents ?? 0,
    available_balance_cents: a.available_balance_cents ?? null,
    frozen_amount_cents: a.frozen_amount_cents ?? 0,
    data_state: a.data_state ?? "ESTIMATE",
    version: 1,
    updated_at: a.updated_at ?? "2025-06-15T00:00:00Z",
  }));

  const categories = fixture.categories.map((c) => ({
    category_code: c.category_id,
    parent_code: c.parent_code ?? null,
    name_zh: c.name_zh,
    name_en: c.name_en ?? null,
    kind: c.kind,
    default_necessity: c.default_necessity_level ?? null,
  }));

  const accountByRawId = new Map(fixture.accounts.map((a) => [a.account_id, a]));
  const ledgerCode = (key) => key.startsWith("acct:")
    ? `ACCOUNT:${accountByRawId.get(key.slice(5))?.account_name ?? key.slice(5)}` : key.slice(4);
  const transactions = fixture.transactions.map((t) => {
    return {
      transaction_id: txnId(t.transaction_id),
      transaction_type: t.transaction_type,
      amount_cents: t.amount_cents,
      currency: t.currency ?? "CNY",
      transaction_date: t.transaction_date,
      posting_date: t.posting_date ?? t.transaction_date,
      status: t.transaction_status ?? "POSTED",
      display_effect: ["INCOME", "REFUND", "REIMBURSEMENT", "DIVIDEND_RECEIVED", "INTEREST_RECEIVED"].includes(t.transaction_type) ? "INFLOW" : ["EXPENSE", "CREDIT_CARD_PURCHASE", "LOAN_REPAYMENT", "CREDIT_CARD_REPAYMENT", "FEE_CHARGED"].includes(t.transaction_type) ? "OUTFLOW" : "NEUTRAL",
      display_effect_version: "mock-1",
      reconciliation_status: t.reconciliation_status ?? "UNRECONCILED",
      source_account_id: t.source_account_id ? accountId(t.source_account_id) : null,
      destination_account_id: t.destination_account_id ? accountId(t.destination_account_id) : null,
      credit_account_id: t.credit_account_id ? accountId(t.credit_account_id) : null,
      category_code: ["TRANSFER", "REIMBURSEMENT"].includes(t.category_id) ? null : t.category_id ?? null,
      merchant_name: t.merchant_name ?? null,
      description: t.description ?? t.memo ?? null,
      data_state: t.data_state ?? "ACTUAL",
      source_type: t.source_type ?? "MANUAL",
      external_transaction_id: t.external_transaction_id ?? null,
      validation_status: t.validation_status ?? "VERIFIED",
      related_transaction_id: t.related_transaction_id ? txnId(t.related_transaction_id) : null,
      voided_by_transaction_id: null,
      version: 1,
      created_at: t.created_at ?? "2025-06-15T00:00:00Z",
      updated_at: t.updated_at ?? "2025-06-15T00:00:00Z",
      entries: entries[t.transaction_id].map((e) => ({
        entry_id: e.entry_id, transaction_id: txnId(t.transaction_id), line_no: e.line_no,
        direction: e.direction, amount_cents: e.amount_cents, ledger_account_id: e.ledger_account_id,
        ledger_account_code: ledgerCode(e.ledgerAccountKey),
        account_id: e.ledgerAccountKey.startsWith("acct:") ? accountId(e.ledgerAccountKey.slice(5)) : null,
        flow_effect: e.flow_effect, entry_role: e.entry_role, expense_bucket: e.expense_bucket,
        principal_cents: null, gain_cents: null, memo: null, currency: t.currency ?? "CNY",
        base_amount_cents: e.amount_cents,
      })),
    };
  });

  // N-10: account-linked assets live in accounts/positions, not a second asset row.
  const assets = fixture.assets.filter((a) => !a.account_id).map((a) => ({
    asset_id: uuid(`asset:${persona}:${a.asset_id}`),
    name: a.asset_name,
    asset_type: a.asset_type,
    account_id: null,
    currency: a.currency ?? "CNY",
    is_restricted: !!a.is_restricted,
    liquidity_level: a.liquidity_level ?? "LOW",
    latest_market_value_cents: a.market_value_cents,
    valuation_date: a.valuation_date ?? null,
    valuation_source: a.valuation_source ?? null,
    data_state: a.valuation_date ? "ACTUAL" : "ESTIMATE",
  }));
  const demoAssetId = uuid(`asset:${persona}:valuation-contract-demo`);
  // Explicit synthetic UI fixture: no financial metric includes this asset.
  assets.push({
    asset_id: demoAssetId, name: "演示资产 · 估值契约样例", asset_type: "OTHER", account_id: null,
    currency: "CNY", is_restricted: false, liquidity_level: "LOW", latest_market_value_cents: 100000,
    valuation_date: "2025-06-30", valuation_source: "USER_ESTIMATE", data_state: "ESTIMATE",
  });
  const assetValuations = [
    { valuation_id: uuid(`valuation:${persona}:1`), asset_id: demoAssetId, as_of: "2025-05-31", market_value_cents: 90000, cost_basis_cents: null, unrealized_gain_loss_cents: null, source: "USER_ESTIMATE" },
    { valuation_id: uuid(`valuation:${persona}:2`), asset_id: demoAssetId, as_of: "2025-06-30", market_value_cents: 100000, cost_basis_cents: null, unrealized_gain_loss_cents: null, source: "USER_ESTIMATE" },
  ];

  const instruments = (fixture.holdings ?? []).map((h) => ({
    instrument_id: uuid(`inst:${persona}:${h.symbol}`),
    ticker: h.symbol,
    name: h.name,
    asset_class: assetClassFor(h.type),
    currency: "CNY",
    risk_level: "MEDIUM",
  }));

  const positions = (fixture.holdings ?? []).map((h) => ({
    position_id: uuid(`pos:${persona}:${h.symbol}`),
    instrument_id: uuid(`inst:${persona}:${h.symbol}`),
    instrument_name: h.name,
    account_id: accountId(fixture.accounts.find((a) => a.account_subtype === "BROKERAGE").account_id),
    quantity: h.qty,
    average_cost_cents: h.cost,
    total_cost_basis_cents: h.qty * h.cost,
    latest_price_cents: h.price ?? null,
    latest_price_as_of: h.price == null ? null : "2025-06-15",
    latest_price_source: h.price == null ? null : "MOCK_FIXTURE",
    market_value_cents: h.price == null ? null : h.qty * h.price,
    na_reason: h.price == null ? "NO_MARKET_PRICE" : null,
    unrealized_pnl_cents: h.price == null ? null : h.qty * (h.price - h.cost),
  }));

  const snapshots = fixture.snapshots.map((s) => ({
    snapshot_id: uuid(`snap:${persona}:${s.snapshot_id}`),
    as_of: s.as_of,
    total_assets_cents: s.total_assets_cents ?? null,
    total_liabilities_cents: s.total_liabilities_cents ?? null,
    net_worth_cents: s.net_worth_cents ?? s.nw ?? null,
    cash_reserve_cents: s.cash_reserve_cents ?? null,
    liquid_assets_cents: s.liquid_assets_cents ?? null,
    data_state: "ESTIMATE", formula_version: "legacy-estimate",
    inputs_hash: "demo",
    computed_at: `${s.as_of}T00:00:00Z`,
  }));

  return {
    persona,
    bookId,
    profile: {
      profile_id: persona,
      display_name: fixture.profile?.display_name ?? persona,
      age: fixture.profile?.age ?? null,
      base_currency: "CNY",
      assumptions: ["synthetic fixture data"],
    },
    accounts,
    categories,
    transactions,
    assets,
    assetValuations,
    instruments,
    positions,
    snapshots,
    normalization: fixture._normalization_report,
  };
}

// ---------------------------------------------------------------------------
// Metric derivation for the mock. The real backend owns these formulas; the
// mock reproduces the Golden dataset numbers so the frontend can develop
// against realistic, contract-shaped responses.
// ---------------------------------------------------------------------------
export function computeMetrics(norm, period = "2025-06", asOf = `${period}-15`) {
  const inPeriod = (t) => t.transaction_date?.startsWith(period);
  const txns = norm.transactions.filter(inPeriod);
  const entries = txns.flatMap((t) => t.entries);

  // Single-side aggregation: income is counted on the INCOME-ledger (CREDIT)
  // leg only, expenses on the PRIMARY (DEBIT) leg only, and debt principal on
  // the DEBIT liability leg. Counting both legs double-counts every figure.
  const sum = (pred) => entries.filter(pred).reduce((acc, e) => acc + e.amount_cents, 0);
  const income = sum((e) => e.flow_effect?.startsWith("INCOME_") && e.direction === "CREDIT");
  const essential = sum((e) => e.expense_bucket === "ESSENTIAL" && e.direction === "DEBIT");
  const discretionary = sum((e) => e.expense_bucket === "DISCRETIONARY" && e.direction === "DEBIT");
  const financialCost = sum((e) => e.expense_bucket === "FINANCIAL_COST" && e.direction === "DEBIT");
  const refund = sum((e) => e.flow_effect === "REFUND_REVERSAL" && e.direction === "DEBIT");
  const expense = essential + discretionary + financialCost - refund;
  const principal = sum((e) => e.flow_effect === "DEBT_PRINCIPAL_REPAY" && e.direction === "DEBIT");

  const assets = norm.accounts.filter((a) => a.normal_side === "ASSET" && a.include_in_net_worth).reduce((s, a) => s + a.balance_cents, 0);
  const liabs = norm.accounts.filter((a) => a.normal_side === "LIABILITY" && a.include_in_net_worth).reduce((s, a) => s + a.balance_cents, 0);
  const posValue = norm.positions.reduce((s, p) => s + p.market_value_cents, 0);
  const totalAssets = assets + posValue;
  const netWorth = totalAssets - liabs;
  const cashSubtypes = new Set(["CASH_WALLET", "BANK_CHECKING", "BANK_SAVINGS", "ALIPAY_BALANCE", "WECHAT_BALANCE", "DIGITAL_WALLET"]);
  const cashReserve = norm.accounts
    .filter((a) => a.normal_side === "ASSET" && cashSubtypes.has(a.subtype) && !a.is_restricted && a.include_in_net_worth)
    .reduce((s, a) => s + a.balance_cents, 0);
  const liquidAssets = norm.accounts
    .filter((a) => a.normal_side === "ASSET" && ["INSTANT", "HIGH"].includes(a.liquidity_level) && !a.is_restricted && a.include_in_net_worth)
    .reduce((s, a) => s + a.balance_cents, 0);

  const m = (metric_id, unit, value_cents, value) => ({
    metric_id,
    metric_version: "mock-1",
    metric_name: metric_id,
    unit,
    value_cents: value_cents ?? null,
    value: value ?? null,
    data_state: "ACTUAL",
    as_of: asOf,
    period: ["total_assets", "total_liabilities", "net_worth", "cash_reserve", "liquid_assets"].includes(metric_id) ? null : period,
    partial: false,
    missing_count: 0,
    estimate_count: null,
    na_reason: null,
    formula_version: "mock-1",
    inputs: {},
  });

  const safeRatio = (n, d) => (d ? n / d : null);
  return [
    m("total_assets", "CNY", totalAssets),
    m("total_liabilities", "CNY", liabs),
    m("net_worth", "CNY", netWorth),
    m("cash_reserve", "CNY", cashReserve),
    m("liquid_assets", "CNY", liquidAssets),
    m("monthly_total_income", "CNY", income),
    m("monthly_total_expense", "CNY", expense),
    m("essential_expense", "CNY", essential),
    m("discretionary_expense", "CNY", discretionary),
    m("financial_cost", "CNY", financialCost),
    m("refund_reversal", "CNY", refund),
    m("debt_service_to_income", "RATIO", null, safeRatio(principal + financialCost, income)),
    m("savings_rate", "RATIO", null, safeRatio(income - expense, income)),
    m("savings_rate_incl_debt_principal", "RATIO", null, safeRatio(income - expense + principal, income)),
    m("net_worth_change", "CNY", null),
    { metric_id: "financial_runway_months", metric_version: "mock-1", metric_name: "Financial Runway", unit: "MONTHS", value: expense > 0 ? Math.round((cashReserve / expense) * 10) / 10 : null, value_cents: null, data_state: "ESTIMATE", na_reason: expense > 0 ? null : "denominator_zero", as_of: null, period, partial: false, missing_count: 0, formula_version: "mock-runway-not-golden" },
  ];
}
