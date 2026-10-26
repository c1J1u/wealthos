/**
 * /views/{page}: page read models (contract ViewPayload).
 * metrics is always a keyed Record<MetricId, MetricResult>.
 *
 * Query semantics (2026-10-26 ext):
 * - period: the flow period for composition/stability/regularity/summary;
 *   omitted = the book default (U-2: latest month with data)
 * - as_of: stock mark; range: snapshot window
 * - transactions page additionally accepts the full /transactions filter
 *   set; its summary is computed over that whole scope, never a page slice
 */
import type { FastifyInstance } from "fastify";
import { ok, errors, ApiError } from "../../http/envelope.js";
import { withBookTx } from "../../http/db.js";
import { assertQuery, parseDate, parseMonth } from "../../http/query.js";
import {
  computeMetrics, toMetricResult, type MetricId, type DataStateFilter,
} from "../analytics/metrics.js";
import { defaultPeriod, addMonths, monthEnd } from "../analytics/period.js";
import { makeViewHelpers } from "../ledger/ledger-view-helpers.js";

const RANGE_MONTHS: Record<string, number> = { "1m": 1, "3m": 3, "6m": 6, "12m": 12 };

const TXN_FILTER_PARAMS = [
  "type", "status", "account_id", "category_code", "q",
  "from", "to", "reconciliation", "data_state",
];

export function registerViewsRoutes(app: FastifyInstance): void {
  app.get("/v1/views/:page", async (req) => {
    const { page } = req.params as { page: string };
    const valid = [
      "overview", "transactions", "accounts", "income", "expenses",
      "cashflow", "assets", "investments", "reports", "analytics", "settings",
    ];
    if (!valid.includes(page)) throw errors.notFound("View");

    const isTxnPage = page === "transactions";
    assertQuery(req, isTxnPage
      ? ["as_of", "range", "period", ...TXN_FILTER_PARAMS]
      : ["as_of", "range", "period"]);

    const q = req.query as Record<string, string | undefined>;
    const range = q.range ?? "3m";
    if (!(range in RANGE_MONTHS)) {
      throw new ApiError({
        status: 400, code: "INVALID_RANGE",
        title: "Invalid range", detail: "allowed: 1m|3m|6m|12m",
      });
    }
    return withBookTx(app, req, async (client) => {
      const bookId = req.session.bookId;
      // Param combination semantics (frontend handoff P1-4, 2026-10-26):
      // period and as_of are independent, but when exactly one is given the
      // other derives from it — only period -> as_of = that month's end;
      // only as_of -> period = that month. Neither -> book default + today.
      const givenPeriod = parseMonth(req, "period");
      const givenAsOf = parseDate(req, "as_of");
      const period = givenPeriod ?? givenAsOf?.slice(0, 7) ?? (await defaultPeriod(client, bookId));
      const asOf = givenAsOf ?? (givenPeriod ? monthEnd(period) : new Date().toISOString().slice(0, 10));
      const ctx = { period, asOf, dataState: "ACTUAL" as DataStateFilter };

      // metrics per page
      const metricSets: Record<string, MetricId[]> = {
        overview: [
          "total_assets", "total_liabilities", "net_worth", "cash_reserve", "liquid_assets",
          "net_worth_change", "financial_runway_months",
          "monthly_total_income", "monthly_total_expense", "essential_expense",
          "discretionary_expense", "financial_cost", "refund_reversal",
          "savings_rate", "savings_rate_incl_debt_principal", "debt_service_to_income",
        ],
        income: ["monthly_total_income", "refund_reversal"],
        expenses: [
          "monthly_total_expense", "essential_expense", "discretionary_expense",
          "financial_cost", "refund_reversal",
        ],
        assets: ["total_assets", "cash_reserve", "liquid_assets"],
      };
      const ids = metricSets[page] ?? [];
      const map = ids.length
        ? await computeMetrics(client, bookId, ids, ctx)
        : new Map<MetricId, import("../analytics/metrics.js").MetricValue>();
      const metrics: Record<string, unknown> = {};
      for (const id of ids) {
        metrics[id] = toMetricResult(id, map.get(id)!, ctx);
      }

      const payload: Record<string, unknown> = { page, metrics };

      // entities per page
      const helpers = makeViewHelpers(client, bookId, asOf);
      if (page === "overview" || page === "assets" || page === "accounts") {
        payload.accounts = await helpers.accounts();
      }
      if (page === "overview" || page === "investments" || page === "assets") {
        payload.positions = await helpers.positions();
      }
      if (page === "overview" || page === "transactions") {
        payload.transactions = await helpers.recentTransactions(10, undefined, period);
      }
      if (page === "income" || page === "expenses") {
        payload.categories = await helpers.categories(page === "income" ? "INCOME" : "EXPENSE");
        payload.transactions = await helpers.recentTransactions(
          50, page === "income"
            ? ["INCOME", "REFUND", "REIMBURSEMENT"]
            : ["EXPENSE", "CREDIT_CARD_PURCHASE"],
          period,
        );
        payload.composition = await helpers.composition(page === "income" ? "INCOME" : "EXPENSE", period);
        payload.summary = await helpers.summary(period, page === "income"
          ? ["INCOME"]
          : ["EXPENSE", "CREDIT_CARD_PURCHASE"]);
        if (page === "income") {
          payload.income_stability = await helpers.incomeStability(period);
        } else {
          payload.expense_regularity = await helpers.expenseRegularity(period);
        }
      }
      if (page === "transactions") {
        // summary over the FULL filter scope, not the current page
        payload.transactions = await helpers.recentTransactions(50, undefined, period);
        payload.summary = await helpers.filteredSummary(req.query as Record<string, string | undefined>);
      }
      if (page === "assets") {
        payload.assets = [];
        payload.composition = await helpers.assetComposition();
      }
      if (page === "overview") {
        // asset allocation on the overview (frontend handoff P1-3):
        // server-side grouping, never client-side math
        payload.composition = await helpers.assetComposition();
      }
      if (page === "overview" || page === "cashflow") {
        payload.snapshots = await helpers.snapshots(addMonths(period, -(RANGE_MONTHS[range!]! - 1)));
      }
      return ok(payload, {
        as_of: asOf, period, data_state: "ACTUAL", partial: false, missing_count: 0,
      });
    });
  });
}
