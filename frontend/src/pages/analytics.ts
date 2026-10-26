import type { MetricId, MetricResult } from "@wealthos/api-client";
import { api, queryClient } from "../data/store";
import { getMetricBundle } from "../data/metrics";
import { responseCompleteness } from "../domain/response-meta";
import { getMetricSeries } from "../data/series";
import { normalizeQueryError, queryKey } from "../data/query";
import { historyRange } from "../domain/period";
import { sessionCacheKey } from "../app/session";
import { el } from "../components/dom";
import { barChart, lineChart } from "../components/lazy-charts";
import { openDrawer } from "../components/drawer";
import { emptyState, errorState, skeleton } from "../components/states";
import { panel, setPanelBody } from "../components/page";
import { dataTable } from "../components/table";
import { dataStateBadgeClass, dataStateLabel, formatMoney, formatRatio } from "../presentation/format";
import { pageHeading, type PageContext } from "./flows";
import { table } from "./page-primitives";
import { chartKind, metricOptions, metricQuery } from "../domain/analytics";
import { comparisonLabel } from "../domain/series";

const METRIC_LABELS: Record<string, string> = {
  total_assets: "总资产", total_liabilities: "总负债", net_worth: "净资产",
  cash_reserve: "现金储备", liquid_assets: "流动资产",
  monthly_total_income: "本月收入", monthly_total_expense: "本月支出",
  essential_expense: "必要支出", discretionary_expense: "非必要支出",
  financial_cost: "财务成本", refund_reversal: "退款冲减",
  debt_service_to_income: "偿债收入比", savings_rate: "储蓄率",
  savings_rate_incl_debt_principal: "储蓄率(含本金)", net_worth_change: "净资产变化",
  financial_runway_months: "Financial Runway",
};
const DEFAULT_METRIC: MetricId = "net_worth";

export async function renderAnalytics({ root, signal, params }: PageContext): Promise<void> {
  pageHeading(root, "分析", "指标随时间如何变化，变化是否可以解释");
  const generation = queryClient.nextGeneration();
  const metricSelect = el("select", { className: "analytics-metric-select", "aria-label": "指标" });
  const rangeTabs = el("div", { className: "segmented", role: "group", "aria-label": "历史期间" });
  const chartTabs = el("div", { className: "segmented", role: "group", "aria-label": "图表类型" });
  const metaRow = el("div", { className: "cell-muted rise rise-1", style: "font-size: var(--text-xs); margin-top: 0.5rem" });
  const chartPanel = panel("指标序列", skeleton(280));
  const tablePanel = panel("序列数据", skeleton(120), true);
  root.append(el("div", { className: "filter-bar analytics-controls rise rise-1" }, [
    el("label", { className: "control-field" }, [el("span", { textContent: "指标" }), metricSelect]),
    el("div", { className: "control-field" }, [el("span", { textContent: "历史期间" }), rangeTabs]),
    el("div", { className: "control-field" }, [el("span", { textContent: "图表类型" }), chartTabs]),
  ]), metaRow,
    el("div", { style: "height: 1rem" }), chartPanel, tablePanel);

  let catalog: MetricResult[] = [];
  let catalogError: ReturnType<typeof normalizeQueryError> | null = null;
  try {
    const res = await getMetricBundle(api, undefined, {}, { signal });
    if (signal.aborted) return;
    catalog = res.metrics;
  } catch (error) {
    catalogError = normalizeQueryError(error);
    if (!signal.aborted) metaRow.textContent = "指标目录暂不可用；请重试后再读取序列。";
  }
  const available = metricOptions(catalog);
  const query = metricQuery(params ?? new URLSearchParams(), available[0] ?? DEFAULT_METRIC);
  const active = query.metric;
  const { range, chart } = query;
  if (!available.includes(active)) {
    metaRow.textContent = `服务端指标目录未提供 ${METRIC_LABELS[active] ?? active} 的口径元数据；仍按所选指标请求序列，不替换为其他指标。`;
  }

  for (const id of available) metricSelect.append(el("option", { value: id, textContent: METRIC_LABELS[id] ?? id, ...(id === active ? { selected: true } : {}) }));
  if (!available.includes(active)) metricSelect.append(el("option", { value: active, textContent: `${METRIC_LABELS[active] ?? active}（目录未提供）`, selected: true, disabled: true }));
  metricSelect.addEventListener("change", () => { location.hash = `#/analytics?metric=${metricSelect.value}&range=${range}&chart=${chart}`; });
  for (const item of [{ id: "1m", label: "近1月" }, { id: "3m", label: "近3月" }, { id: "6m", label: "近6月" }, { id: "12m", label: "近12月" }]) {
    const button = el("button", { textContent: item.label, "aria-pressed": String(item.id === range) });
    button.addEventListener("click", () => { location.hash = `#/analytics?metric=${active}&range=${item.id}&chart=${chart}`; });
    rangeTabs.append(button);
  }
  for (const item of [{ id: "line", label: "折线" }, { id: "area", label: "面积" }, { id: "bar", label: "柱状" }]) {
    const button = el("button", { textContent: item.label, "aria-pressed": String(item.id === chart) });
    button.addEventListener("click", () => { location.hash = `#/analytics?metric=${active}&range=${range}&chart=${item.id}`; });
    chartTabs.append(button);
  }

  const load = async (force = false) => {
    setPanelBody(chartPanel, skeleton(280));
    setPanelBody(tablePanel, skeleton(120), true);
    if (catalogError) {
      setPanelBody(chartPanel, errorState(catalogError, () => location.reload()));
      setPanelBody(tablePanel, emptyState("没有可显示的序列", "指标目录恢复后再读取，避免用不完整口径解释数据。"));
      return;
    }
    const meta = await api.getMeta({ signal }).catch(() => null);
    if (signal.aborted) return;
    const asOf = params?.get("as_of") ?? meta?.data.today;
    const period = asOf ? historyRange(range, asOf) : null;
    const state = await queryClient.run(generation, queryKey({ ...sessionCacheKey(), resource: "series", metric: active, range, asOf }), (requestSignal) =>
      getMetricSeries(api, { metric: active, granularity: "month", from: period?.from, to: period?.to }, { signal: requestSignal }), { force });
    if (signal.aborted || state.status === "idle") return;
    if (state.status === "error" || !state.data) {
      const error = state.error ?? { message: "序列加载失败" };
      const unavailable = error.code === "UNKNOWN_METRIC" || error.code === "UNSUPPORTED_CAPABILITY";
      setPanelBody(chartPanel, errorState(error, unavailable ? undefined : () => load(true)));
      setPanelBody(tablePanel, emptyState("没有可显示的序列", "请重试或调整指标和期间。"));
      return;
    }
    const points = state.data.data.points;
    const metric = catalog.find((item) => item.metric_id === active);
    const unit = metric?.unit;
    if (points.length === 0) {
      setPanelBody(chartPanel, emptyState("该期间没有序列数据", "服务端返回空序列；不填充 0，不借用其他期间。"));
      setPanelBody(tablePanel, emptyState("没有可显示的序列", "可调整期间或重试；MoM/YoY 需要服务端提供比较 projection。"), true);
      return;
    }
    const formatPoint = (point: (typeof points)[number]) => point.value_cents != null ? formatMoney(point.value_cents)
      : unit === "RATIO" ? formatRatio(point.value) : point.value == null ? "N/A" : String(point.value);
    const chartPoints: { x: string; y: number | null }[] = points.map((point) => ({
      x: point.period, y: point.value_cents != null ? point.value_cents / 100 : point.value,
    }));
    const drawable = chartPoints.filter((point): point is { x: string; y: number } => point.y != null);
    const options = {
      title: METRIC_LABELS[active] ?? active,
      description: drawable.length === 0 ? "当前期间没有可绘制的指标值；服务端缺失保持 N/A，不补 0。" : "缺失点保留在表格，不补 0。",
      source: "/analytics/series",
      timeRange: period ? `${period.from} 至 ${period.to}` : "服务端默认期间",
      formatY: (value: number) => unit === "RATIO" ? formatRatio(value) : unit === "MONTHS" ? `${value.toLocaleString("zh-CN", { maximumFractionDigits: 1 })} 个月` : `¥${value.toLocaleString("zh-CN", { maximumFractionDigits: 0 })}`,
    };
    const chartNode = chart === "bar"
      ? await barChart(drawable.map((point) => ({ name: point.x, value: point.y })), options)
      : await lineChart(drawable, options, chartPoints, chart === "area");
    if (signal.aborted) return;
    setPanelBody(chartPanel, chartNode);
    const comparisonTable = el("div");
    const comparisonNote = el("p", { className: "cell-muted", textContent: "MoM/YoY 直接展示服务端 projection：CNY 为相对变化率，比率/月数为差值；缺参照或零分母保持 N/A。" });
    const comparisonRows = dataTable(["期间", "值", "MoM 环比", "YoY 同比", "数据态"], points.map((point) => [
      point.period, el("span", { className: point.value_cents == null && point.value == null ? "na" : "cell-money", textContent: formatPoint(point) }),
      el("span", { className: point.mom?.value == null && point.mom?.value_cents == null ? "na" : "", textContent: comparisonLabel(point.mom, unit) }),
      el("span", { className: point.yoy?.value == null && point.yoy?.value_cents == null ? "na" : "", textContent: comparisonLabel(point.yoy, unit) }),
      el("span", { className: dataStateBadgeClass(point.data_state), textContent: dataStateLabel(point.data_state) }),
    ]));
    comparisonTable.append(comparisonNote, comparisonRows);
    setPanelBody(tablePanel, comparisonTable, true);
    const detailButton = el("button", { className: "button", textContent: "查看指标口径" });
    detailButton.addEventListener("click", () => { void showMetricDefinition(metric, active, signal); });
    const seriesCompleteness = responseCompleteness(state.meta);
    const metricCompleteness = metric?.partial === true;
    const partialText = metricCompleteness || seriesCompleteness.partial
      ? `≈ 部分数据${seriesCompleteness.missingCount != null && seriesCompleteness.missingCount > 0 ? ` · 缺失 ${seriesCompleteness.missingCount} 项` : metric?.missing_count ? ` · 缺失 ${metric.missing_count} 项` : ""}`
      : "完整数据";
    metaRow.replaceChildren(el("span", { textContent: metric ? `口径版本 ${metric.metric_version} · as of ${metric.as_of ?? "—"} · ${partialText} ` : `来源：/analytics/series · ${active} · ${partialText} ` }), detailButton);
  };
  await load();
}

async function showMetricDefinition(catalogMetric: MetricResult | undefined, id: MetricId, pageSignal: AbortSignal): Promise<void> {
  const handle = openDrawer({ title: METRIC_LABELS[id] ?? id, label: "指标口径" });
  const signal = AbortSignal.any([pageSignal, handle.signal]);
  let resolved = catalogMetric;
  try {
    const response = await api.getMetric(id, {}, { signal });
    if (!signal.aborted) resolved = response.data;
  } catch { /* The catalog remains the explicit fallback for definition metadata. */ }
  if (signal.aborted || handle.closed) return;
  const metric = resolved;
  handle.body.append(el("dl", { className: "kv" }, [
    el("dt", { textContent: "指标 ID" }), el("dd", { textContent: id }),
    el("dt", { textContent: "指标版本" }), el("dd", { textContent: metric?.metric_version ?? "N/A" }),
    el("dt", { textContent: "公式版本" }), el("dd", { textContent: metric?.formula_version ?? "N/A" }),
    el("dt", { textContent: "单位" }), el("dd", { textContent: metric?.unit ?? "N/A" }),
    el("dt", { textContent: "as-of" }), el("dd", { textContent: metric?.as_of ?? "N/A" }),
    el("dt", { textContent: "期间" }), el("dd", { textContent: metric?.period ?? "N/A" }),
    el("dt", { textContent: "数据态" }), el("dd", { textContent: dataStateLabel(metric?.data_state) }),
    el("dt", { textContent: "null 处理" }), el("dd", { textContent: metric?.na_reason ?? "缺失值保持 N/A，不补 0。" }),
    el("dt", { textContent: "公式说明" }), el("dd", { textContent: "服务端未提供 formula/inclusion/exclusion 文本；不在前端推测或拼接财务公式。" }),
  ]));
}
