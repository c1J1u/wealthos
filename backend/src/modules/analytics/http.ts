/**
 * Analytics routes: /metrics, /metrics/{id}, /analytics/series,
 * /reports/{balance-sheet,income-statement,cash-flow}, /snapshots.
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { PoolClient } from "pg";
import { ok, errors, ApiError } from "../../http/envelope.js";
import { withBookTx } from "../../http/db.js";
import { assertQuery, parseDate, parseMonth, parseBool } from "../../http/query.js";
import {
  computeMetrics, toMetricResult, flowFigures, METRIC_CATALOG,
  ALL_METRIC_IDS, type MetricId, type DataStateFilter,
} from "./metrics.js";
import { stockFigures, accountBalancesAsOf, positionsAsOf, balanceSheetExclusions } from "./balances.js";
import { buildSeries } from "./series.js";
import { defaultPeriod, monthEnd, monthStart, addMonths, monthsBetween } from "./period.js";
import { createHash } from "node:crypto";

function parseMetricIds(req: FastifyRequest, required: boolean): MetricId[] {
  const raw = (req.query as Record<string, string | undefined>).ids;
  if (raw === undefined || raw === "") {
    if (required) {
      throw new ApiError({
        status: 400, code: "IDS_REQUIRED",
        title: "ids parameter is required",
        detail: "pass a comma-separated list of metric ids",
      });
    }
    return ALL_METRIC_IDS; // omitted = full catalog (B-17)
  }
  const ids = raw.split(",").map((s) => s.trim()).filter(Boolean) as MetricId[];
  for (const id of ids) {
    if (!(id in METRIC_CATALOG)) {
      throw new ApiError({
        status: 400, code: "UNKNOWN_METRIC",
        title: "Unknown metric id", detail: String(id),
      });
    }
  }
  if (new Set(ids).size !== ids.length) {
    throw new ApiError({
      status: 400, code: "DUPLICATE_METRIC_ID",
      title: "Duplicate metric id in ids", detail: raw,
    });
  }
  return ids;
}

function parseDataState(req: FastifyRequest, includeEstimate: boolean): DataStateFilter {
  const raw = (req.query as Record<string, string | undefined>).data_state;
  if (raw === undefined) return includeEstimate ? "ALL" : "ACTUAL";
  if (raw !== "ACTUAL" && raw !== "ESTIMATE") {
    throw new ApiError({
      status: 400, code: "INVALID_DATA_STATE",
      title: "Invalid data_state", detail: "allowed: ACTUAL|ESTIMATE",
    });
  }
  return raw;
}

interface ResolvedCtx {
  period: string;
  asOf: string;
  dataState: DataStateFilter;
}

async function resolveCtx(req: FastifyRequest, client: PoolClient, bookId: string): Promise<ResolvedCtx> {
  const period = parseMonth(req, "period");
  const asOf = parseDate(req, "as_of");
  const includeEstimate = parseBool(req, "include_estimate");
  const dataState = parseDataState(req, includeEstimate);
  // Same derivation as /views (handoff P1-4): exactly one of period/as_of
  // given -> the other derives from it; neither -> book default + today.
  const effectivePeriod = period ?? asOf?.slice(0, 7) ?? (await defaultPeriod(client, bookId));
  const effectiveAsOf = asOf ?? (period ? monthEnd(effectivePeriod) : new Date().toISOString().slice(0, 10));
  return { period: effectivePeriod, asOf: effectiveAsOf, dataState };
}

export function registerAnalyticsRoutes(app: FastifyInstance): void {
  // ---- /metrics ----------------------------------------------------------
  app.get("/v1/metrics", async (req) => {
    assertQuery(req, ["ids", "as_of", "period", "data_state", "include_estimate"]);
    const ids = parseMetricIds(req, false); // B-17: omitted ids = full catalog
    return withBookTx(app, req, async (client) => {
      const ctx = await resolveCtx(req, client, req.session.bookId);
      const map = await computeMetrics(client, req.session.bookId, ids, ctx);
      const rows = ids.map((id) => toMetricResult(id, map.get(id)!, ctx));
      return ok({ metrics: rows }, { as_of: ctx.asOf, period: ctx.period, data_state: "ACTUAL", partial: false, missing_count: 0 });
    });
  });

  app.get("/v1/metrics/:id", async (req) => {
    assertQuery(req, ["as_of", "period", "data_state", "include_estimate"]);
    const { id } = req.params as { id: string };
    if (!(id in METRIC_CATALOG)) throw errors.notFound("Metric");
    return withBookTx(app, req, async (client) => {
      const ctx = await resolveCtx(req, client, req.session.bookId);
      const map = await computeMetrics(client, req.session.bookId, [id as MetricId], ctx);
      const result = toMetricResult(id as MetricId, map.get(id as MetricId)!, ctx);
      // catalog detail from metric_definitions seed where available
      const def = await client.query(
        `SELECT formula, inclusion_rules, exclusion_rules, null_handling
           FROM metric_definitions WHERE metric_id = $1 AND metric_version = '1.0'`,
        [id],
      );
      if (def.rows[0]) {
        Object.assign(result, {
          formula: def.rows[0].formula,
          inclusion_rules: def.rows[0].inclusion_rules,
          exclusion_rules: def.rows[0].exclusion_rules,
          null_handling: def.rows[0].null_handling,
        });
      }
      return ok(result, { as_of: ctx.asOf, period: ctx.period });
    });
  });

  // ---- /analytics/series -------------------------------------------------
  app.get("/v1/analytics/series", async (req) => {
    assertQuery(req, ["metric", "from", "to", "granularity", "data_state"]);
    const q = req.query as Record<string, string | undefined>;
    const metricId = q.metric;
    if (!metricId || !(metricId in METRIC_CATALOG)) {
      throw new ApiError({
        status: 400, code: "UNKNOWN_METRIC",
        title: "Unknown metric id", detail: String(metricId),
      });
    }
    const granularity = q.granularity ?? "month";
    if (granularity !== "month") {
      throw new ApiError({
        status: 400, code: "UNSUPPORTED_GRANULARITY",
        title: "Unsupported granularity",
        detail: `P1 supports month only, got: ${granularity}`,
      });
    }
    const from = parseDate(req, "from");
    const to = parseDate(req, "to");
    if (from && to && from > to) {
      throw new ApiError({
        status: 400, code: "INVALID_RANGE",
        title: "from must be <= to", detail: `from=${from} to=${to}`,
      });
    }
    const includeEstimate = parseBool(req, "include_estimate");
    const dataState = parseDataState(req, includeEstimate);
    return withBookTx(app, req, async (client) => {
      const points = await buildSeries(client, req.session.bookId, metricId as MetricId, {
        ...(from ? { from } : {}),
        ...(to ? { to } : {}),
        dataState,
      });
      return ok({ metric_id: metricId, granularity: "month", points });
    });
  });

  // ---- reports -----------------------------------------------------------
  app.get("/v1/reports/balance-sheet", async (req) => {
    assertQuery(req, ["as_of"]);
    const asOf = parseDate(req, "as_of") ?? new Date().toISOString().slice(0, 10);
    return withBookTx(app, req, async (client) => {
      const balances = await accountBalancesAsOf(client, req.session.bookId, asOf);
      const positions = await positionsAsOf(client, req.session.bookId, asOf);
      const excluded = await balanceSheetExclusions(client, req.session.bookId, asOf);

      const rows: Array<Record<string, unknown>> = [];
      let totalAssets = 0n;
      let totalLiabilities = 0n;
      for (const b of balances) {
        if (!b.include_in_net_worth) continue;
        if (b.normal_side === "ASSET") {
          rows.push({
            label: b.name, account_id: b.account_id,
            amount_cents: Number(b.balance_cents), data_state: b.data_state,
          });
          totalAssets += b.balance_cents;
        } else {
          rows.push({
            label: b.name, account_id: b.account_id,
            amount_cents: Number(b.balance_cents), data_state: b.data_state,
          });
          totalLiabilities += b.balance_cents;
        }
      }
      for (const p of positions) {
        if (p.market_value_cents === null) continue; // already in excluded
        rows.push({
          label: `${p.instrument_name} (${p.ticker})`, account_id: p.account_id,
          amount_cents: Number(p.market_value_cents), data_state: "ACTUAL",
        });
        totalAssets += p.market_value_cents;
      }

      return ok({
        as_of: asOf,
        total_assets_cents: Number(totalAssets),
        total_liabilities_cents: Number(totalLiabilities),
        net_worth_cents: Number(totalAssets - totalLiabilities),
        rows,
        excluded_assets: excluded,
      }, { as_of: asOf });
    });
  });

  app.get("/v1/reports/income-statement", async (req) => {
    assertQuery(req, ["period"]);
    const periodParam = parseMonth(req, "period");
    return withBookTx(app, req, async (client) => {
      const period = periodParam ?? (await defaultPeriod(client, req.session.bookId));
      const f = await flowFigures(client, req.session.bookId, period, "ACTUAL");
      // rows: income by category, expense by bucket — same read model as totals
      const incomeRows = await client.query(
        `SELECT COALESCE(c.name_zh, la.code) AS label, SUM(e.amount_cents)::text AS amount
           FROM transaction_entries e
           JOIN transactions t ON t.transaction_id = e.transaction_id
           JOIN ledger_accounts la ON la.ledger_account_id = e.ledger_account_id
           LEFT JOIN categories c ON c.category_code = la.category_code
          WHERE t.book_id = $1::uuid AND t.status IN ('POSTED','RECONCILED')
            AND t.data_state = 'ACTUAL'
            AND to_char(t.transaction_date, 'YYYY-MM') = $2
            AND la.class = 'INCOME' AND e.entry_role = 'PRIMARY'
          GROUP BY 1 ORDER BY SUM(e.amount_cents) DESC`,
        [req.session.bookId, period],
      );
      const rows = [
        ...incomeRows.rows.map((r: { label: string; amount: string }) => ({
          label: `收入 · ${r.label}`, account_id: null,
          amount_cents: Number(r.amount), data_state: "ACTUAL",
        })),
        { label: "支出 · 必要", account_id: null, amount_cents: Number(f.essential_cents), data_state: "ACTUAL" },
        { label: "支出 · 非必要", account_id: null, amount_cents: Number(f.discretionary_cents), data_state: "ACTUAL" },
        { label: "支出 · 财务成本", account_id: null, amount_cents: Number(f.financial_cost_cents), data_state: "ACTUAL" },
        { label: "支出 · 退款冲减", account_id: null, amount_cents: Number(f.refund_reversal_cents), data_state: "ACTUAL" },
      ];
      return ok({
        period,
        income_cents: Number(f.income_cents),
        essential_cents: Number(f.essential_cents),
        discretionary_cents: Number(f.discretionary_cents),
        financial_cost_cents: Number(f.financial_cost_cents),
        refund_reversal_cents: Number(f.refund_reversal_cents),
        expense_cents: Number(f.expense_cents),
        net_cents: Number(f.income_cents - f.expense_cents),
        rows,
      }, { data_state: "ACTUAL" });
    });
  });

  app.get("/v1/reports/cash-flow", async (req) => {
    assertQuery(req, ["from", "to", "account_id"]);
    const from = parseDate(req, "from");
    const to = parseDate(req, "to");
    const accountId = (req.query as Record<string, string | undefined>).account_id;
    if (from && to && from > to) {
      throw new ApiError({
        status: 400, code: "INVALID_RANGE",
        title: "from must be <= to", detail: `from=${from} to=${to}`,
      });
    }
    return withBookTx(app, req, async (client) => {
      const bookId = req.session.bookId;
      const defaultP = await defaultPeriod(client, bookId);
      const fromDate = from ?? monthStart(defaultP);
      const toDate = to ?? monthEnd(defaultP);

      const params: unknown[] = [bookId, fromDate, toDate];
      let accountJoin = "";
      if (accountId) {
        accountJoin = `AND a.account_id = $4::uuid`;
        params.push(accountId);
      }
      const r = await client.query<{ bucket: string; total: string }>(
        `SELECT COALESCE(fe.cashflow_bucket, 'NONE') AS bucket,
                SUM(CASE WHEN e.direction = 'DEBIT' THEN e.amount_cents ELSE -e.amount_cents END)::text AS total
           FROM transaction_entries e
           JOIN transactions t ON t.transaction_id = e.transaction_id
           JOIN ledger_accounts la ON la.ledger_account_id = e.ledger_account_id
           JOIN accounts a ON a.account_id = la.account_id
           JOIN flow_effects fe ON fe.code = e.flow_effect
          WHERE t.book_id = $1::uuid
            AND t.status IN ('POSTED','RECONCILED')
            AND t.data_state = 'ACTUAL'
            AND t.transaction_date >= $2::date
            AND t.transaction_date <= $3::date
            AND e.entry_role = 'FUNDING'
            AND la.account_id IS NOT NULL
            AND a.subtype IN ('CASH_WALLET','BANK_CHECKING','BANK_SAVINGS',
                              'ALIPAY_BALANCE','WECHAT_BALANCE','DIGITAL_WALLET')
            AND fe.cashflow_bucket IS NOT NULL
            ${accountJoin}
          GROUP BY 1`,
        params,
      );
      const by: Record<string, number> = { OPERATING: 0, INVESTING: 0, FINANCING: 0 };
      for (const row of r.rows) {
        if (row.bucket in by) by[row.bucket] = Number(row.total);
      }
      const operating = by["OPERATING"] ?? 0;
      const investing = by["INVESTING"] ?? 0;
      const financing = by["FINANCING"] ?? 0;
      const net = operating + investing + financing;
      return ok({
        from_date: fromDate,
        to_date: toDate,
        operating_cents: operating,
        investing_cents: investing,
        financing_cents: financing,
        net_cents: net,
        ...(accountId ? { account_id: accountId } : {}),
        note: "内部转账与资产交换的现金流桶为空，合并口径下自然抵消；公积金付租的资金腿不进入现金流，经济支出仍计入。",
      });
    });
  });

  // ---- /snapshots: computed, never legacy (N-12) ------------------------
  app.get("/v1/snapshots", async (req) => {
    assertQuery(req, ["from", "to"]);
    const from = parseDate(req, "from");
    const to = parseDate(req, "to");
    return withBookTx(app, req, async (client) => {
      const bookId = req.session.bookId;
      const bounds = await client.query<{ first: string | null; last: string | null }>(
        `SELECT to_char(min(transaction_date), 'YYYY-MM') AS first,
                to_char(max(transaction_date), 'YYYY-MM') AS last
           FROM transactions
          WHERE book_id = $1::uuid AND status IN ('POSTED','RECONCILED')`,
        [bookId],
      );
      const firstData = bounds.rows[0]?.first;
      const lastData = bounds.rows[0]?.last;
      if (!firstData || !lastData) return ok([]);

      const lo = (from ? from.slice(0, 7) : firstData) > firstData ? (from!.slice(0, 7)) : firstData;
      const hi = (to ? to.slice(0, 7) : lastData) < lastData ? (to!.slice(0, 7)) : lastData;
      if (lo > hi) return ok([]);

      const months = monthsBetween(lo, hi);
      const out = [];
      for (const m of months) {
        const asOf = monthEnd(m);
        const st = await stockFigures(client, bookId, asOf);
        out.push({
          snapshot_id: snapshotId(bookId, m),
          as_of: asOf,
          total_assets_cents: Number(st.total_assets_cents),
          total_liabilities_cents: Number(st.total_liabilities_cents),
          net_worth_cents: Number(st.net_worth_cents),
          cash_reserve_cents: Number(st.cash_reserve_cents),
          liquid_assets_cents: Number(st.liquid_assets_cents),
          formula_version: "1.0",
          // inputs_hash omitted: schema declares string (not nullable) and the
          // field is not required; computed snapshots carry no stored inputs yet.
          computed_at: new Date().toISOString(),
        });
      }
      out.reverse(); // newest first, matching list conventions
      return ok(out);
    });
  });
}

function snapshotId(bookId: string, month: string): string {
  const h = createHash("sha256").update(`${bookId}:snapshot:${month}`).digest("hex");
  return [h.slice(0, 8), h.slice(8, 12), h.slice(12, 16), h.slice(16, 20), h.slice(20, 32)].join("-");
}
