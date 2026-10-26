import type { MetricId } from "@wealthos/api-client";
import type { ApiClient } from "../data/store";
import { getMetricSeries } from "../data/series";
import { normalizeQueryError } from "../data/query";
import { lineChart } from "./lazy-charts";
import { el } from "./dom";
import { errorState, skeleton, emptyState } from "./states";
import { setPanelBody } from "./page";
import { table } from "../pages/page-primitives";
import { formatMoney, formatRatio, dataStateBadgeClass, dataStateLabel } from "../presentation/format";

export async function loadMetricTrend(
  client: ApiClient,
  target: HTMLElement,
  metric: MetricId,
  title: string,
  range: { from: string; to: string } | null,
  signal: AbortSignal,
): Promise<void> {
  const load = async () => {
    setPanelBody(target, skeleton(240));
    try {
      const response = await getMetricSeries(client, { metric, granularity: "month", from: range?.from, to: range?.to }, { signal });
      if (signal.aborted) return;
      const points = response.data.points;
      if (!Array.isArray(points)) throw new Error("序列响应 points 格式不正确");
      if (points.length === 0) {
        setPanelBody(target, emptyState("该期间没有趋势数据", "服务端返回空序列；不填充 0，不借用其他期间。"));
        return;
      }
      const unit = metric.includes("rate") || metric.includes("to_income") ? "RATIO" : "CNY";
      const chartPoints = points.map((point) => ({ x: point.period, y: point.value_cents != null ? point.value_cents / 100 : point.value }));
      const drawable = chartPoints.filter((point): point is { x: string; y: number } => point.y != null);
      const format = (value: number) => unit === "RATIO" ? formatRatio(value) : `¥${value.toLocaleString("zh-CN", { maximumFractionDigits: 2 })}`;
      setPanelBody(target, el("div", { className: "stack" }, [
        await lineChart(drawable, { title, description: `${title} · 缺失点不补 0。`, source: "/analytics/series", timeRange: range ? `${range.from} 至 ${range.to}` : "服务端默认期间", formatY: format }, chartPoints),
        table(["期间", "值", "数据态"], points.map((point) => [point.period, point.value_cents != null ? formatMoney(point.value_cents) : unit === "RATIO" ? formatRatio(point.value) : "N/A", el("span", { className: dataStateBadgeClass(point.data_state), textContent: dataStateLabel(point.data_state) })])),
      ]));
    } catch (error) {
      if (!signal.aborted) setPanelBody(target, errorState(normalizeQueryError(error), load));
    }
  };
  if (!range) {
    setPanelBody(target, emptyState("期间尚未确定", "服务端期间不可用时不请求其他期间的趋势。"));
    return;
  }
  await load();
}
