import type { MetricId, MetricResult, Transaction } from "@wealthos/api-client";
import { api } from "../data/store";
import { getMetricBundle } from "../data/metrics";
import { normalizeQueryError } from "../data/query";
import { isPeriod, monthRange } from "../domain/period";
import { filterFailure, unsupportedTransactionFilters } from "../domain/transactions";
import { el } from "../components/dom";
import { panel, setPanelBody } from "../components/page";
import { emptyState, errorState, skeleton } from "../components/states";
import { dataTable } from "../components/table";
import { dataStateBadgeClass, dataStateLabel, formatDate, formatMoney, formatRatio, txnTypeLabel } from "../presentation/format";
import { transactionAmountLabel } from "../components/transaction-amount";
import { routeWithParams } from "../app/route-state";
import { dataText } from "../app/locale";
import { metricPartialBadge } from "../components/metric-state";
import { compositionView, transactionSummaryView } from "../components/view-read-models";
import { viewPeriodErrors } from "../domain/view-models";

export interface PageContext {
  root: HTMLElement;
  signal: AbortSignal;
  params?: URLSearchParams;
}

export function pageHeading(root: HTMLElement, title: string, subtitle: string): void {
  root.replaceChildren(el("div", { className: "page-header rise" }, [el("div", {}, [
    el("h1", { textContent: title }), el("div", { className: "page-header__sub", textContent: subtitle }),
  ])]));
}

export function metricCard(label: string, metric: MetricResult | undefined, format: "money" | "ratio" = "money", unavailableHint?: string): HTMLElement {
  const value = format === "money" ? formatMoney(metric?.value_cents ?? null) : formatRatio(metric?.value ?? null);
  return el("div", { className: "metric-card" }, [
    el("div", { className: "metric-card__label", textContent: label }),
    el("div", { className: "metric-card__value", textContent: value }),
    el("div", { className: "metric-card__meta" }, [
      metric ? el("span", { className: dataStateBadgeClass(metric.data_state), textContent: dataStateLabel(metric.data_state) }) : "",
      metricPartialBadge(metric),
      el("span", { textContent: metric?.na_reason ?? unavailableHint ?? metric?.period ?? metric?.as_of ?? "服务端未提供" }),
    ]),
  ]);
}

export function metricGrid(): HTMLElement {
  return el("div", { className: "metric-grid rise rise-1", style: "margin-bottom: 1rem" });
}

export function periodPicker(period: string, page: string, label: string): HTMLElement {
  const picker = el("div", { className: "filter-bar rise rise-1", style: "margin-bottom: 0.75rem" });
  const input = el("input", { type: "month", lang: "zh-CN", value: period, "aria-label": label, required: true });
  const apply = el("button", { className: "button", textContent: "应用期间" });
  const submit = () => {
    if (!isPeriod(input.value)) { input.setCustomValidity("请选择有效月份"); input.reportValidity(); return; }
    location.hash = routeWithParams(`#/${page}${location.hash.split("?")[1] ? `?${location.hash.split("?")[1]}` : ""}`, { period: input.value }, ["cursor"]);
  };
  apply.addEventListener("click", submit);
  input.addEventListener("keydown", (event) => { if (event.key === "Enter") submit(); });
  picker.append(el("span", { className: "cell-muted", textContent: "期间" }), input, apply);
  return picker;
}

export async function loadMetrics(
  grid: HTMLElement,
  ids: readonly MetricId[],
  labels: Record<string, string>,
  period: string,
  signal: AbortSignal,
): Promise<void> {
  const load = async () => {
    grid.replaceChildren(skeleton(86));
    try {
      const result = await getMetricBundle(api, ids, { period: period || undefined }, { signal });
      if (signal.aborted) return;
      const metrics = new Map(result.metrics.map((m) => [m.metric_id, m]));
      grid.replaceChildren(...ids.map((id) => metricCard(labels[id] ?? id, metrics.get(id))));
    } catch (error) {
      if (!signal.aborted) grid.replaceChildren(errorState(normalizeQueryError(error), load));
    }
  };
  await load();
}

export function tabBar(
  definitions: { id: string; label: string }[],
  active: string,
  onSelect: (id: string) => void,
): HTMLElement {
  const tabs = el("div", { className: "segmented rise rise-1", role: "group", "aria-label": "收支视图" });
  for (const definition of definitions) {
    const button = el("button", { textContent: definition.label, "aria-pressed": String(definition.id === active) });
    button.addEventListener("click", () => {
      const params = new URLSearchParams(location.hash.split("?")[1] ?? "");
      params.set("tab", definition.id);
      history.replaceState(null, "", `${location.hash.split("?")[0]}?${params.toString()}`);
      tabs.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b === button)));
      onSelect(definition.id);
    });
    tabs.append(button);
  }
  return tabs;
}

export function categoryLabeler(categories: { category_code: string; name_zh: string }[]) {
  const names = new Map(categories.map((c) => [c.category_code, c.name_zh]));
  return (code: string | null | undefined) => code ? (names.get(code) ?? code) : "未分类";
}

export function transactionTable(items: Transaction[], label: (code: string | null | undefined) => string, settlement = false): HTMLElement {
  const note = el("p", { className: "cell-muted", textContent: "金额方向优先使用服务端 display_effect；旧响应回退 flow_effect。不改变原始金额。" });
  const rows = dataTable(["日期", settlement ? "说明" : "商户/来源", "分类", "类型", "金额", "数据"], items.map((t) => [
    formatDate(t.transaction_date), dataText(t.merchant_name ?? t.description ?? "—"), dataText(label(t.category_code)), txnTypeLabel(t.transaction_type),
    transactionAmountLabel(t),
    el("span", { className: dataStateBadgeClass(t.data_state), textContent: dataStateLabel(t.data_state) }),
  ]));
  return el("div", {}, [note, rows]);
}

export async function loadTransactionPanel(
  target: HTMLElement,
  query: { type: string; from?: string; to?: string },
  signal: AbortSignal,
  render: (items: Transaction[]) => void,
): Promise<void> {
  const load = async () => {
    setPanelBody(target, skeleton(160), true);
    try {
      const res = await api.listTransactions({ ...query, limit: 100 }, { signal });
      if (signal.aborted) return;
      const ignored = unsupportedTransactionFilters(query, res.data);
      if (ignored.length > 0) { setPanelBody(target, errorState(filterFailure(ignored)), true); return; }
      render(res.data);
    } catch (error) {
      if (!signal.aborted) setPanelBody(target, errorState(normalizeQueryError(error), load), true);
    }
  };
  await load();
}

export function flowPageContext(ctx: PageContext, page: "income" | "expenses") {
  const { root, signal, params } = ctx;
  pageHeading(root, page === "income" ? "收入" : "支出", page === "income" ? "赚了什么，收入是否稳定和集中" : "钱花在哪里，哪些必要、哪些可优化");
  const requestedPeriod = params?.get("period");
  const period = isPeriod(requestedPeriod) ? requestedPeriod : "";
  const range = monthRange(period);
  const grid = metricGrid();
  const trend = panel("月度趋势", skeleton(240));
  const composition = panel(page === "income" ? "来源分布" : "分类构成", skeleton(200));
  const breakdown = el("div", { className: "grid-2" }, [trend, composition]);
  const listHolder = el("div");
  const summary = panel("期间汇总", skeleton(100));
  return { root, signal, params, period, range, grid, breakdown, trend, composition, summary, listHolder };
}

export async function loadFlowView(
  page: "income" | "expenses",
  period: string,
  signal: AbortSignal,
  targets: { composition: HTMLElement; summary: HTMLElement; breakdown: HTMLElement },
): Promise<void> {
  const load = async () => {
    setPanelBody(targets.composition, skeleton(180));
    setPanelBody(targets.summary, skeleton(90));
    try {
      const response = await api.getView(page, period ? { period } : {}, { signal });
      if (signal.aborted) return;
      if (viewPeriodErrors(period, response.meta.period).length > 0) throw new Error("服务端页面视图期间与请求不一致，已停止展示。");
      setPanelBody(targets.composition, await compositionView(response.data.composition, `/views/${page}`));
      setPanelBody(targets.summary, transactionSummaryView(response.data.summary));
    } catch (error) {
      if (!signal.aborted) {
        setPanelBody(targets.composition, errorState(normalizeQueryError(error), load));
        setPanelBody(targets.summary, errorState(normalizeQueryError(error), load));
      }
    }
  };
  await load();
}
