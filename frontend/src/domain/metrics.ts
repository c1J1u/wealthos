import type { MetricResult } from "@wealthos/api-client";

const STOCK_METRICS = new Set(["total_assets", "total_liabilities", "net_worth", "cash_reserve", "liquid_assets"]);

export function metricContractErrors(metric: MetricResult, query: { as_of?: string; period?: string }): string[] {
  const errors: string[] = [];
  if (query.period && !STOCK_METRICS.has(metric.metric_id) && metric.period !== query.period) errors.push("期间");
  if (query.as_of && metric.as_of && metric.as_of !== query.as_of) errors.push("as-of");
  return errors;
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

// Generated types describe intent, not wire reality. Reject invalid values at
// the boundary rather than formatting them as plausible financial figures.
export function normalizeMetric(value: unknown): MetricResult | null {
  if (typeof value !== "object" || value === null) return null;
  const metric = value as MetricResult;
  if (typeof metric.metric_id !== "string" || typeof metric.metric_version !== "string" || typeof metric.metric_name !== "string" || typeof metric.unit !== "string") return null;
  if (!["ACTUAL", "ESTIMATE", "BUDGET", "FORECAST", "SCENARIO"].includes(metric.data_state) || typeof metric.partial !== "boolean"
    || !Number.isSafeInteger(metric.missing_count) || metric.missing_count < 0) return null;
  if (metric.value_cents != null && (!Number.isSafeInteger(metric.value_cents) || !finiteNumber(metric.value_cents))) return null;
  if (metric.value != null && !finiteNumber(metric.value)) return null;
  if (metric.unit === "RATIO" && metric.value_cents != null) return null;
  if (metric.unit === "CNY" && metric.value != null) return null;
  return metric;
}

export function metricBundle(data: unknown, requestedIds?: readonly string[]): {
  metrics: MetricResult[];
  missingIds: string[];
  ignoredIds: string[];
  invalidIds: string[];
} {
  if (!Array.isArray(data) && !(typeof data === "object" && data !== null && "metrics" in data && Array.isArray(data.metrics))) {
    throw new Error("指标响应格式不正确");
  }
  const rows = Array.isArray(data) ? data
    : typeof data === "object" && data !== null && "metrics" in data && Array.isArray(data.metrics)
      ? data.metrics : [];
  const metrics = rows.map(normalizeMetric).filter((m): m is MetricResult => m !== null);
  const requested = new Set(requestedIds ?? metrics.map((m) => m.metric_id));
  const visible = metrics.filter((m) => requested.has(m.metric_id));
  const present: Set<string> = new Set(visible.map((m) => m.metric_id));
  const invalidIds = requestedIds ? rows.filter((row) => {
    if (typeof row !== "object" || row === null) return true;
    const id = (row as { metric_id?: unknown }).metric_id;
    return typeof id === "string" && requested.has(id) && normalizeMetric(row) === null;
  }).map((row) => (row as { metric_id: string }).metric_id) : [];
  return {
    metrics: visible,
    missingIds: requestedIds?.filter((id) => !present.has(id) && !invalidIds.includes(id)) ?? [],
    ignoredIds: requestedIds ? metrics.filter((m) => !requested.has(m.metric_id)).map((m) => m.metric_id) : [],
    invalidIds,
  };
}
