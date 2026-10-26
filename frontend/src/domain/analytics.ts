import type { MetricResult } from "@wealthos/api-client";

export type ChartKind = "line" | "area" | "bar";

export const P1_METRIC_IDS = [
  "total_assets", "total_liabilities", "net_worth", "cash_reserve", "liquid_assets",
  "monthly_total_income", "monthly_total_expense", "essential_expense", "discretionary_expense",
  "financial_cost", "refund_reversal", "debt_service_to_income", "savings_rate",
  "savings_rate_incl_debt_principal", "net_worth_change", "financial_runway_months",
] as const satisfies readonly MetricResult["metric_id"][];

export function metricOptions(catalog: MetricResult[]): MetricResult["metric_id"][] {
  return [...new Set(catalog.map((metric) => metric.metric_id).filter((id): id is MetricResult["metric_id"] => (P1_METRIC_IDS as readonly string[]).includes(id)))];
}

export function chartKind(value: string | null): ChartKind {
  return value === "area" || value === "bar" ? value : "line";
}

export function metricQuery(params: URLSearchParams, fallback: MetricResult["metric_id"]): { metric: MetricResult["metric_id"]; range: string; chart: ChartKind } {
  const requested = params.get("metric");
  return {
    metric: requested && (P1_METRIC_IDS as readonly string[]).includes(requested) ? requested as MetricResult["metric_id"] : fallback,
    range: ["1m", "3m", "6m", "12m"].includes(params.get("range") ?? "") ? params.get("range")! : "6m",
    chart: chartKind(params.get("chart")),
  };
}
