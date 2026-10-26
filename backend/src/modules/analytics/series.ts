/**
 * Time series with MoM/YoY projections (Ruling B-14/B-15).
 * Only the `month` granularity is supported in P1; anything else is an
 * explicit 400, never a silently-different result.
 */
import type { PoolClient } from "pg";
import {
  computeMetrics, METRIC_CATALOG, type MetricId, type MetricValue, type DataStateFilter,
} from "./metrics.js";
import { stockFigures } from "./balances.js";
import { monthsBetween, addMonths, monthEnd } from "./period.js";

export interface SeriesPoint {
  period: string;
  value: number | null;
  value_cents: number | null;
  data_state: "ACTUAL" | "ESTIMATE";
  mom: Comparison | null;
  yoy: Comparison | null;
}

export interface Comparison {
  value: number | null;
  value_cents: number | null;
  reference_period: string;
  na_reason: string | null;
}

export async function buildSeries(
  client: PoolClient,
  bookId: string,
  metricId: MetricId,
  opts: { from?: string; to?: string; dataState: DataStateFilter },
): Promise<SeriesPoint[]> {
  const cat = METRIC_CATALOG[metricId];

  // Data bounds: only months inside the data span are emitted (B-14).
  const bounds = await client.query<{ first: string | null; last: string | null }>(
    `SELECT to_char(min(transaction_date), 'YYYY-MM') AS first,
            to_char(max(transaction_date), 'YYYY-MM') AS last
       FROM transactions
      WHERE book_id = $1::uuid AND status IN ('POSTED','RECONCILED')`,
    [bookId],
  );
  const firstData = bounds.rows[0]?.first;
  const lastData = bounds.rows[0]?.last;
  if (!firstData || !lastData) return [];

  const fromMonth = opts.from ? opts.from.slice(0, 7) : addMonths(lastData, -5);
  const toMonth = opts.to ? opts.to.slice(0, 7) : lastData;
  const lo = fromMonth > firstData ? fromMonth : firstData;
  const hi = toMonth < lastData ? toMonth : lastData;
  if (lo > hi) return [];

  const months = monthsBetween(lo, hi);

  // values for the request window plus the reference months (prev/yoy)
  const needed = new Set<string>(months);
  for (const m of months) {
    needed.add(addMonths(m, -1));
    needed.add(addMonths(m, -12));
  }

  const values = new Map<string, number | null>(); // null means N/A
  for (const m of needed) {
    const v = await metricAt(client, bookId, metricId, cat.kind, m, opts.dataState);
    values.set(m, v);
  }

  return months.map((m) => {
    const v = values.get(m) ?? null;
    return {
      period: m,
      value: cat.unit === "CNY" ? null : v,
      value_cents: cat.unit === "CNY" ? v : null,
      data_state: "ACTUAL",
      mom: comparison(cat.unit, v, values.get(addMonths(m, -1)) ?? null, addMonths(m, -1)),
      yoy: comparison(cat.unit, v, values.get(addMonths(m, -12)) ?? null, addMonths(m, -12)),
    };
  });
}

async function metricAt(
  client: PoolClient,
  bookId: string,
  metricId: MetricId,
  kind: string,
  month: string,
  dataState: DataStateFilter,
): Promise<number | null> {
  if (kind === "stock") {
    const st = await stockFigures(client, bookId, monthEnd(month));
    switch (metricId) {
      case "total_assets": return Number(st.total_assets_cents);
      case "total_liabilities": return Number(st.total_liabilities_cents);
      case "net_worth": return Number(st.net_worth_cents);
      case "cash_reserve": return Number(st.cash_reserve_cents);
      case "liquid_assets": return Number(st.liquid_assets_cents);
      default: return null;
    }
  }
  const ctx = { period: month, asOf: monthEnd(month), dataState };
  const map = await computeMetrics(client, bookId, [metricId], ctx);
  const v: MetricValue | undefined = map.get(metricId);
  if (!v) return null;
  return v.value_cents ?? v.value;
}

function comparison(
  unit: string,
  current: number | null,
  reference: number | null,
  referencePeriod: string,
): Comparison {
  if (current === null || reference === null) {
    return {
      value: null, value_cents: null,
      reference_period: referencePeriod,
      na_reason: "MISSING_REFERENCE",
    };
  }
  if (unit === "CNY") {
    if (reference === 0) {
      return { value: null, value_cents: null, reference_period: referencePeriod, na_reason: "REFERENCE_ZERO" };
    }
    const rel = (current - reference) / Math.abs(reference);
    return { value: rel, value_cents: null, reference_period: referencePeriod, na_reason: null };
  }
  // RATIO / MONTHS: difference in the metric's own unit
  return {
    value: current - reference,
    value_cents: null,
    reference_period: referencePeriod,
    na_reason: null,
  };
}
