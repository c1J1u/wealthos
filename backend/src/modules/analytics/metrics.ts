/**
 * Metric engine: the 15 contract MetricIds + financial_runway_months (B-13).
 * Single source of truth for /metrics, /metrics/{id}, /views/* and series.
 *
 * Money metrics carry value_cents; RATIO/MONTHS carry value. Null semantics
 * per FI-16: null + na_reason, never 0.
 */
import type { PoolClient } from "pg";
import { stockFigures } from "./balances.js";
import { monthEnd, monthStart, addMonths } from "./period.js";

export type MetricId =
  | "total_assets" | "total_liabilities" | "net_worth" | "cash_reserve"
  | "liquid_assets" | "monthly_total_income" | "monthly_total_expense"
  | "essential_expense" | "discretionary_expense" | "financial_cost"
  | "refund_reversal" | "debt_service_to_income" | "savings_rate"
  | "savings_rate_incl_debt_principal" | "net_worth_change"
  | "financial_runway_months";

export type MetricUnit = "CNY" | "RATIO" | "MONTHS" | "COUNT";

interface CatalogEntry {
  name: string;
  unit: MetricUnit;
  kind: "stock" | "flow" | "ratio" | "derived";
}

export const METRIC_CATALOG: Record<MetricId, CatalogEntry> = {
  total_assets: { name: "总资产", unit: "CNY", kind: "stock" },
  total_liabilities: { name: "总负债", unit: "CNY", kind: "stock" },
  net_worth: { name: "净资产", unit: "CNY", kind: "stock" },
  cash_reserve: { name: "现金储备", unit: "CNY", kind: "stock" },
  liquid_assets: { name: "流动资产", unit: "CNY", kind: "stock" },
  monthly_total_income: { name: "月收入", unit: "CNY", kind: "flow" },
  monthly_total_expense: { name: "月经济支出", unit: "CNY", kind: "flow" },
  essential_expense: { name: "必要支出", unit: "CNY", kind: "flow" },
  discretionary_expense: { name: "非必要支出", unit: "CNY", kind: "flow" },
  financial_cost: { name: "财务成本", unit: "CNY", kind: "flow" },
  refund_reversal: { name: "退款冲减", unit: "CNY", kind: "flow" },
  debt_service_to_income: { name: "偿债收入比", unit: "RATIO", kind: "ratio" },
  savings_rate: { name: "储蓄率（口径A）", unit: "RATIO", kind: "ratio" },
  savings_rate_incl_debt_principal: { name: "含偿债储蓄率（口径C）", unit: "RATIO", kind: "ratio" },
  net_worth_change: { name: "净资产变化", unit: "CNY", kind: "derived" },
  financial_runway_months: { name: "财务跑道", unit: "MONTHS", kind: "derived" },
};

export const ALL_METRIC_IDS = Object.keys(METRIC_CATALOG) as MetricId[];

export interface FlowFigures {
  income_cents: bigint;
  essential_cents: bigint;
  discretionary_cents: bigint;
  financial_cost_cents: bigint;
  refund_reversal_cents: bigint;
  expense_cents: bigint;
  principal_cents: bigint;
  interest_cents: bigint;
  fees_cents: bigint;
}

export interface MetricValue {
  metric_id: MetricId;
  value_cents: number | null;
  value: number | null;
  na_reason: string | null;
}

export type DataStateFilter = "ACTUAL" | "ESTIMATE" | "ALL";

/**
 * Flow figures for one month. dataState: 'ACTUAL' (default per contract
 * §6), 'ESTIMATE' (only estimates), 'ALL' (include_estimate=true).
 */
export async function flowFigures(
  client: PoolClient,
  bookId: string,
  month: string,
  dataState: DataStateFilter = "ACTUAL",
): Promise<FlowFigures> {
  const stateFilter =
    dataState === "ALL" ? "" : `AND t.data_state = '${dataState}'`;
  const r = await client.query<{
    inc: string; ess: string; disc: string; fin: string; ref: string;
    p: string; i: string; f: string;
  }>(`
    WITH scope AS (
      SELECT e.*
        FROM transaction_entries e
        JOIN transactions t ON t.transaction_id = e.transaction_id
       WHERE t.book_id = $1::uuid
         AND t.status IN ('POSTED','RECONCILED')
         ${stateFilter}
         AND to_char(t.transaction_date, 'YYYY-MM') = $2
    )
    SELECT
      COALESCE(SUM(s.amount_cents) FILTER (
        WHERE la.class = 'INCOME' AND s.entry_role = 'PRIMARY' AND fe.is_income), 0)::text AS inc,
      COALESCE(SUM(s.amount_cents) FILTER (
        WHERE la.class = 'EXPENSE' AND s.entry_role = 'PRIMARY' AND s.expense_bucket = 'ESSENTIAL'), 0)::text AS ess,
      COALESCE(SUM(s.amount_cents) FILTER (
        WHERE la.class = 'EXPENSE' AND s.entry_role = 'PRIMARY' AND s.expense_bucket = 'DISCRETIONARY'), 0)::text AS disc,
      COALESCE(SUM(s.amount_cents) FILTER (
        WHERE la.class = 'EXPENSE' AND s.entry_role = 'PRIMARY' AND s.expense_bucket = 'FINANCIAL_COST'), 0)::text AS fin,
      COALESCE(SUM(s.amount_cents) FILTER (
        WHERE la.class = 'EXPENSE' AND s.entry_role = 'PRIMARY' AND s.expense_bucket = 'REFUND_REVERSAL'), 0)::text AS ref,
      COALESCE(SUM(s.amount_cents) FILTER (
        WHERE la.class = 'LIABILITY' AND s.entry_role = 'PRIMARY' AND s.direction = 'DEBIT'
          AND s.flow_effect = 'DEBT_PRINCIPAL_REPAY'), 0)::text AS p,
      COALESCE(SUM(s.amount_cents) FILTER (
        WHERE la.class = 'EXPENSE' AND s.entry_role = 'PRIMARY' AND s.flow_effect = 'DEBT_INTEREST'), 0)::text AS i,
      COALESCE(SUM(s.amount_cents) FILTER (
        WHERE la.class = 'EXPENSE' AND s.entry_role = 'PRIMARY' AND s.flow_effect = 'DEBT_FEE'), 0)::text AS f
      FROM scope s
      JOIN ledger_accounts la ON la.ledger_account_id = s.ledger_account_id
      JOIN flow_effects fe ON fe.code = s.flow_effect
  `, [bookId, month]);
  const row = r.rows[0]!;
  const inc = BigInt(row.inc);
  const ess = BigInt(row.ess);
  const disc = BigInt(row.disc);
  const fin = BigInt(row.fin);
  const ref = BigInt(row.ref);
  return {
    income_cents: inc,
    essential_cents: ess,
    discretionary_cents: disc,
    financial_cost_cents: fin,
    refund_reversal_cents: ref,
    expense_cents: ess + disc + fin - ref,
    principal_cents: BigInt(row.p),
    interest_cents: BigInt(row.i),
    fees_cents: BigInt(row.f),
  };
}

export interface MetricContext {
  /** resolved period for flow metrics (default: latest month with data) */
  period: string;
  /** as-of mark for stock metrics */
  asOf: string;
  dataState: DataStateFilter;
}

function money(id: MetricId, cents: bigint): MetricValue {
  return { metric_id: id, value_cents: Number(cents), value: null, na_reason: null };
}
function num(id: MetricId, v: number | null, na: string | null = null): MetricValue {
  return { metric_id: id, value_cents: null, value: v, na_reason: v === null ? na : null };
}

/**
 * Compute a set of metrics. Each metric is independent; unknown ids throw
 * UNKNOWN_METRIC before any query runs.
 */
export async function computeMetrics(
  client: PoolClient,
  bookId: string,
  ids: MetricId[],
  ctx: MetricContext,
): Promise<Map<MetricId, MetricValue>> {
  for (const id of ids) {
    if (!(id in METRIC_CATALOG)) {
      throw Object.assign(new Error(`unknown metric id: ${id}`), { code: "UNKNOWN_METRIC" });
    }
  }
  const out = new Map<MetricId, MetricValue>();
  const needStock = ids.some((id) => METRIC_CATALOG[id].kind === "stock");
  const needFlow = ids.some(
    (id) => ["flow", "ratio", "derived"].includes(METRIC_CATALOG[id].kind),
  );

  const stock = needStock
    ? await stockFigures(client, bookId, ctx.asOf)
    : null;
  const flow = needFlow
    ? await flowFigures(client, bookId, ctx.period, ctx.dataState)
    : null;

  for (const id of ids) {
    const cat = METRIC_CATALOG[id];
    if (cat.kind === "stock" && stock) {
      switch (id) {
        case "total_assets": out.set(id, money(id, stock.total_assets_cents)); break;
        case "total_liabilities": out.set(id, money(id, stock.total_liabilities_cents)); break;
        case "net_worth": out.set(id, money(id, stock.net_worth_cents)); break;
        case "cash_reserve": out.set(id, money(id, stock.cash_reserve_cents)); break;
        case "liquid_assets": out.set(id, money(id, stock.liquid_assets_cents)); break;
        default: break;
      }
      continue;
    }
    if (!flow) continue;
    switch (id) {
      case "monthly_total_income": out.set(id, money(id, flow.income_cents)); break;
      case "monthly_total_expense": out.set(id, money(id, flow.expense_cents)); break;
      case "essential_expense": out.set(id, money(id, flow.essential_cents)); break;
      case "discretionary_expense": out.set(id, money(id, flow.discretionary_cents)); break;
      case "financial_cost": out.set(id, money(id, flow.financial_cost_cents)); break;
      case "refund_reversal": out.set(id, money(id, flow.refund_reversal_cents)); break;
      case "debt_service_to_income": {
        const d = flow.income_cents;
        out.set(id, d <= 0n
          ? num(id, null, "DENOMINATOR_ZERO")
          : num(id, Number(flow.principal_cents + flow.interest_cents + flow.fees_cents) / Number(d)));
        break;
      }
      case "savings_rate": {
        const d = flow.income_cents;
        out.set(id, d <= 0n
          ? num(id, null, "DENOMINATOR_ZERO")
          : num(id, Number(flow.income_cents - flow.expense_cents) / Number(d)));
        break;
      }
      case "savings_rate_incl_debt_principal": {
        const d = flow.income_cents;
        out.set(id, d <= 0n
          ? num(id, null, "DENOMINATOR_ZERO")
          : num(id, Number(flow.income_cents - flow.expense_cents + flow.principal_cents) / Number(d)));
        break;
      }
      case "net_worth_change": {
        // Frozen formula (B-12): Inc − Exp + valuation_change where
        // valuation_change counts only instruments priced at BOTH marks.
        const st = await stockFigures(client, bookId, ctx.asOf, {
          from: monthStart(ctx.period),
          to: monthEnd(ctx.period),
        });
        out.set(id, money(id, flow.income_cents - flow.expense_cents + st.valuation_change_cents));
        break;
      }
      case "financial_runway_months": {
        // B-13: cash_reserve(period end) / avg ACTUAL expense of last 3 months.
        const st = await stockFigures(client, bookId, monthEnd(ctx.period));
        const months = [addMonths(ctx.period, -2), addMonths(ctx.period, -1), ctx.period];
        let sum = 0n;
        for (const m of months) {
          const f = await flowFigures(client, bookId, m, "ACTUAL");
          sum += f.expense_cents;
        }
        const avg = sum / 3n;
        out.set(id, avg <= 0n
          ? num(id, null, "NO_EXPENSE_BASE")
          : num(id, Number(st.cash_reserve_cents) / Number(avg)));
        break;
      }
      default: break;
    }
  }
  return out;
}

/** MetricResult DTO row per contract. */
export function toMetricResult(
  id: MetricId,
  v: MetricValue,
  ctx: MetricContext,
  estimateCount: number | null = null,
): Record<string, unknown> {
  const cat = METRIC_CATALOG[id];
  const isMoney = cat.unit === "CNY";
  return {
    metric_id: id,
    metric_version: "1.0",
    metric_name: cat.name,
    unit: cat.unit,
    value_cents: isMoney ? v.value_cents : null,
    value: isMoney ? null : v.value,
    data_state: ctx.dataState === "ALL" ? "ESTIMATE" : ctx.dataState,
    as_of: cat.kind === "stock" ? ctx.asOf : null,
    period: cat.kind === "stock" ? null : ctx.period,
    partial: false,
    missing_count: 0,
    estimate_count: estimateCount,
    na_reason: v.na_reason,
    formula_version: "1.0",
  };
}
