import { el } from "./dom";

export function metricPartialBadge(metric: { partial?: boolean; missing_count?: number } | undefined): HTMLElement | "" {
  if (metric?.partial !== true) return "";
  return el("span", {
    className: "metric-card__partial",
    textContent: `≈ 部分数据${metric.missing_count != null && metric.missing_count > 0 ? ` · 缺失 ${metric.missing_count} 项` : ""}`,
  });
}
