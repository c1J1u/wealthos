import type { SeriesPoint } from "@wealthos/api-client";
import { isPeriod } from "./period";

export interface SeriesQuery {
  metric: string;
  granularity?: string;
  from?: string;
  to?: string;
}

export function seriesContractErrors(series: {
  metric_id: string;
  granularity: string;
  points: (Omit<SeriesPoint, "data_state"> & { data_state?: string })[];
}, query: SeriesQuery): string[] {
  const errors: string[] = [];
  if (series.metric_id !== query.metric) errors.push("指标");
  if (query.granularity && series.granularity !== query.granularity) errors.push("粒度");
  const outside = series.points.filter((p) =>
    (query.from && p.period.slice(0, 7) < query.from.slice(0, 7)) || (query.to && p.period.slice(0, 7) > query.to.slice(0, 7)));
  if (outside.length > 0) errors.push("请求期间");
  if (query.granularity === "month" && series.points.some((point) => !isPeriod(point.period))) errors.push("数据点期间");
  if (series.points.some((point) => point.value_cents != null && !Number.isSafeInteger(point.value_cents))) errors.push("金额");
  if (series.points.some((point) => point.value != null && !Number.isFinite(point.value))) errors.push("比率");
  if (series.points.some((point) => point.data_state != null && !["ACTUAL", "ESTIMATE", "BUDGET", "FORECAST", "SCENARIO"].includes(point.data_state))) errors.push("数据态");
  if (new Set(series.points.map((point) => point.period)).size !== series.points.length) errors.push("重复期间");
  const projections = series.points.flatMap((point) => [point.mom, point.yoy]);
  if (projections.some((projection) => projection?.value_cents != null && !Number.isSafeInteger(projection.value_cents))) errors.push("比较金额");
  if (projections.some((projection) => projection?.value != null && !Number.isFinite(projection.value))) errors.push("比较比率");
  return errors;
}

export function comparisonLabel(projection: NonNullable<SeriesPoint["mom"]> | null | undefined, unit: string | undefined): string {
  if (!projection) return "N/A · 服务端未提供";
  const reference = projection.reference_period ? ` · ${projection.reference_period}` : "";
  if (projection.value_cents != null) return `${formatSignedCents(projection.value_cents)}${reference}`;
  if (projection.value == null || !Number.isFinite(projection.value)) return `N/A${projection.na_reason ? ` · ${projection.na_reason}` : ""}${reference}`;
  if (unit === "CNY") return `${formatSignedNumber(projection.value * 100, 1)}%${reference}`;
  if (unit === "RATIO") return `${formatSignedNumber(projection.value * 100, 1)}pp${reference}`;
  if (unit === "MONTHS") return `${formatSignedNumber(projection.value, 1)} 个月${reference}`;
  return `${formatSignedNumber(projection.value, 2)}${reference}`;
}

function formatSignedCents(value: number): string {
  return `${value > 0 ? "+" : value < 0 ? "-" : ""}¥${(Math.abs(value) / 100).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatSignedNumber(value: number, digits: number): string {
  return `${value > 0 ? "+" : ""}${value.toLocaleString("zh-CN", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}
