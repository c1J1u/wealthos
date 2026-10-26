import type { CashFlowReport, MetricResult, Transaction, ViewPayload } from "@wealthos/api-client";
import { api, queryClient } from "../data/store";
import { queryKey } from "../data/query";
import { el } from "../components/dom";
import { errorState, skeleton, emptyState, partialState } from "../components/states";
import { formatMoney, formatRatio, dataStateBadgeClass, dataStateLabel, formatDate, txnTypeLabel } from "../presentation/format";
import { transactionAmountLabel } from "../components/transaction-amount";
import { lineChart } from "../components/lazy-charts";
import { sessionCacheKey } from "../app/session";
import { defaultBusinessPeriod } from "../app/session";
import { dataTable } from "../components/table";
import { panel, setPanelBody, setPanelError } from "../components/page";
import { getMetricBundle } from "../data/metrics";
import { historyRange, isDate, isPeriod, monthRange, recentMonthCutoff } from "../domain/period";
import { reportPeriodErrors } from "../domain/reports";
import { valueMetricCard } from "./page-primitives";
import { metricDeck, metricDeckFailure } from "../components/metric-deck";
import { responseCompleteness } from "../domain/response-meta";
import { dataText } from "../app/locale";
import { metricPartialBadge } from "../components/metric-state";
import { compositionView } from "../components/view-read-models";
import { viewPeriodErrors } from "../domain/view-models";

const KPI_DEFS: { id: string; label: string; format: "money" | "ratio"; drill: string }[] = [
  { id: "total_assets", label: "总资产", format: "money", drill: "assets" },
  { id: "total_liabilities", label: "总负债", format: "money", drill: "accounts" },
  { id: "net_worth", label: "净资产", format: "money", drill: "reports" },
  { id: "cash_reserve", label: "现金储备", format: "money", drill: "cashflow" },
  { id: "monthly_total_income", label: "本月收入", format: "money", drill: "income" },
  { id: "monthly_total_expense", label: "本月经济支出", format: "money", drill: "expenses" },
  { id: "savings_rate", label: "储蓄率 A", format: "ratio", drill: "analytics" },
  { id: "debt_service_to_income", label: "偿债收入比", format: "ratio", drill: "analytics" },
];
const METRIC_IDS = [...KPI_DEFS.map((definition) => definition.id), "savings_rate_incl_debt_principal", "net_worth_change", "financial_runway_months"];

export async function renderOverview(root: HTMLElement, signal: AbortSignal): Promise<void> {
  root.replaceChildren();
  const generation = queryClient.nextGeneration();
  const rangeSeg = el("div", { className: "segmented", role: "group", "aria-label": "时间范围" });
  const RANGES = [
    { value: "1m", label: "本月" },
    { value: "3m", label: "近3月" },
    { value: "6m", label: "近6月" },
    { value: "12m", label: "近12月" },
  ] as const;
  const requestedRange = new URLSearchParams(location.hash.split("?")[1] ?? "").get("range") ?? "6m";
  const currentRange = RANGES.some((r) => r.value === requestedRange) ? requestedRange as typeof RANGES[number]["value"] : "6m";
  for (const r of RANGES) {
    const b = el("button", { textContent: r.label, "aria-pressed": String(r.value === currentRange) });
    b.addEventListener("click", () => {
      const p = new URLSearchParams(location.hash.split("?")[1] ?? "");
      p.set("range", r.value);
      location.hash = `#/overview?${p.toString()}`;
    });
    rangeSeg.append(b);
  }
  root.append(
    el("div", { className: "page-header rise" }, [
      el("div", {}, [
        el("h1", { textContent: "总览" }),
        el("div", { className: "page-header__sub", textContent: "财务健康的 10 秒判断" }),
      ]),
      rangeSeg,
    ]),
  );
  const kpiGrid = metricDeck(Array.from({ length: 8 }, () => skeleton(86)), [skeleton(86)]);
  const cashCard = el("a", { className: "metric-card metric-card--link", "data-kpi": "net-cash-flow", href: "#/cashflow" }, [skeleton(70)]);
  kpiGrid.querySelector('[data-metric-group="supporting"]')?.append(cashCard);
  const charts = el("div", { className: "grid-2 rise rise-2", style: "margin-top: 1rem" });
  const nwPanel = panel("净资产趋势", skeleton(240));
  const allocPanel = panel("资产配置", skeleton(180));
  charts.append(nwPanel, allocPanel);
  const recentPanel = panel("最近交易", skeleton(160), true);
  recentPanel.style.marginTop = "1rem";
  const deferredPanel = el("div", { className: "grid-4-widgets rise rise-3", style: "margin-top: 1rem; display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 1rem" }, [
    widgetPlaceholder("预算", "P3 接入"),
    widgetPlaceholder("目标", "P3 接入"),
    widgetPlaceholder("定存到期", "P3 接入"),
    widgetPlaceholder("复盘摘要", "P4 接入"),
  ]);
  const kpiNotice = el("div");
  const viewNotice = el("div");
  root.append(kpiGrid, kpiNotice, charts, viewNotice, recentPanel, deferredPanel);
  let hasViewTransactions = false;
  let viewFailed = false;
  const pageParams = new URLSearchParams(location.hash.split("?")[1] ?? "");
  const requestedPeriod = pageParams.get("period");
  const requestedAsOf = pageParams.get("as_of");
  let activePeriod = isPeriod(requestedPeriod) ? requestedPeriod : "";
  let activeAsOf = isDate(requestedAsOf) ? requestedAsOf : "";
  const hasExplicitContext = Boolean(activePeriod || activeAsOf);
  const contextReady = (async () => {
    if (!activePeriod && !activeAsOf) activePeriod = await api.getMeta({ signal }).then((response) => defaultBusinessPeriod(response.data)).catch(() => "");
    if (hasExplicitContext && activePeriod && !activeAsOf) activeAsOf = monthRange(activePeriod)?.to ?? "";
    if (!activePeriod && activeAsOf) activePeriod = activeAsOf.slice(0, 7);
    return { period: activePeriod || undefined, as_of: activeAsOf || undefined };
  })();

  const loadTrend = async (force = false) => {
    setPanelBody(nwPanel, skeleton(240));
    const context = await contextReady;
    const businessDate = context.as_of ?? sessionCacheKey().asOf;
    const snapshotRange: { from?: string; to?: string } = isDate(businessDate) ? historyRange(currentRange, businessDate) ?? {} : {};
    const trend = await queryClient.run(
      generation,
      queryKey({ ...sessionCacheKey(), resource: "snapshots", range: currentRange }),
      (requestSignal) => api.listSnapshots(snapshotRange, { signal: requestSignal }),
      { ttlMs: 60_000, force },
    );
    if (trend.status === "idle") return;
    if (trend.status === "error" || !trend.data) {
      setPanelError(nwPanel, trend.error, () => loadTrend(true));
      return;
    }
    const latest = trend.data.data.map((item) => item.as_of).sort().at(-1);
    const cutoff = latest ? recentMonthCutoff(latest, currentRange) : null;
    const sorted = [...trend.data.data].filter((snapshot) => !cutoff || snapshot.as_of >= cutoff).sort((a, b) => a.as_of.localeCompare(b.as_of));
    const chartNode = await lineChart(
      sorted.map((s) => ({ x: s.as_of.slice(0, 7), y: s.net_worth_cents / 100 })),
      { title: `净资产 · ${currentRange}`, description: `服务端财务快照；不从图表重算 KPI。${trend.meta?.data_state === "ESTIMATE" ? " 包含 ESTIMATE 历史估算，不能替代当前指标。" : ""}`, source: "/snapshots", timeRange: snapshotRange.from && snapshotRange.to ? `${snapshotRange.from} 至 ${snapshotRange.to}` : "服务端默认期间", formatY: (v) => `¥${v.toLocaleString("zh-CN", { maximumFractionDigits: 0 })}` },
    );
    if (signal.aborted) return;
    setPanelBody(nwPanel, chartNode);
  };

  const loadView = async (force = false) => {
    setPanelBody(allocPanel, skeleton(180));
    const context = await contextReady;
    const state = await queryClient.run(
      generation,
      queryKey({ ...sessionCacheKey(), resource: "overview", range: currentRange, ...context }),
      (requestSignal) => api.getView("overview", { range: currentRange, ...context }, { signal: requestSignal }),
      { ttlMs: 60_000, force },
    );
    if (state.status === "idle") return;
    if (state.status === "error" || !state.data) {
      viewFailed = true;
      viewNotice.replaceChildren(errorState(state.error ?? { message: "页面读模型加载失败；其余独立模块仍可查看。" }, () => loadView(true)));
      setPanelError(allocPanel, state.error ?? { message: "资产配置不可用" }, () => loadView(true));
      await loadRecent();
      return;
    }
    viewFailed = false;
    viewNotice.replaceChildren();
    hasViewTransactions = false;
    const view: ViewPayload = state.data.data;
    if (signal.aborted) return;
    if (viewPeriodErrors(context.period ?? "", state.data.meta.period).length > 0) {
      setPanelError(allocPanel, { message: "总览读模型期间与请求不一致，已停止展示。" }, () => loadView(true));
      await loadRecent();
      return;
    }
    setPanelBody(allocPanel, await compositionView(view.composition, "/views/overview"));
    if (Array.isArray(view.transactions)) {
      hasViewTransactions = true;
      renderRecent(view.transactions);
    recentPanel.querySelector(".panel-inline-note")?.remove();
    } else {
      void loadRecent();
    }

  }

  const loadMetrics = async (force = false) => {
    const { period } = await contextReady;
    if (signal.aborted) return;
    if (period) {
      cashCard.setAttribute("aria-label", `净现金流，前往 ${period} 现金流`);
      void loadNetCashFlow(period);
    } else {
      cashCard.replaceChildren(...valueMetricCard("净现金流", "N/A", undefined, "服务端期间未提供，未混用其他期间").childNodes);
    }
    const state = await queryClient.run(
      generation,
      queryKey({ ...sessionCacheKey(), resource: "metrics", ids: METRIC_IDS.join(","), ...await contextReady }),
      (requestSignal) => getMetricBundle(api, METRIC_IDS, { period, as_of: activeAsOf || undefined }, { signal: requestSignal }),
      { ttlMs: 60_000, force },
    );
    if (state.status === "idle") return;
    if (state.status === "error" || !state.data) {
      metricDeckFailure(kpiGrid, errorState(state.error ?? { message: "指标加载失败" }, () => loadMetrics(true)), valueMetricCard("Financial Runway", "N/A", undefined, "指标接口不可用；不由前端拼算"));
      return;
    }
    const byId = new Map(state.data.metrics.map((m) => [m.metric_id, m]));
    const runway = byId.get("financial_runway_months");
    const runwayCard = valueMetricCard("Financial Runway", runway?.value == null || runway.unit !== "MONTHS" ? "N/A" : `${runway.value.toLocaleString("zh-CN", { maximumFractionDigits: 1 })} 个月`, runway?.data_state, runway?.na_reason ?? (runway?.unit !== "MONTHS" && runway ? "指标单位待修正" : runway?.period ?? runway?.as_of ?? "服务端近 3 个月均值口径"), runway);
    const cards = KPI_DEFS.map((def) => metricCard(def.label, byId.get(def.id as MetricResult["metric_id"]), def.format, def.drill, def.id === "net_worth" ? byId.get("net_worth_change") : def.id === "savings_rate" ? byId.get("savings_rate_incl_debt_principal") : undefined));
    kpiGrid.replaceChildren(...Array.from(metricDeck(cards, [runwayCard, cashCard]).childNodes));
    const missing = new Set([...state.data.missingIds.filter((id) => id !== "financial_runway_months"), ...KPI_DEFS.filter((d) => {
      const m = byId.get(d.id as MetricResult["metric_id"]);
      return m?.value_cents == null && m?.value == null;
    }).map((d) => d.id)]);
    kpiNotice.replaceChildren();
    if (missing.size > 0) kpiNotice.append(partialState(missing.size, `服务端未提供 ${[...missing].join("、")}；N/A 不代表 0`));
  };
  const loadNetCashFlow = async (period: string, force = false) => {
    const range = monthRange(period)!;
    const state = await queryClient.run(generation, queryKey({ ...sessionCacheKey(), resource: "overview-net-cash-flow", period }), (requestSignal) =>
      api.getCashFlow(range, { signal: requestSignal }), { force });
    if (signal.aborted || state.status === "idle") return;
    const card = kpiGrid.querySelector<HTMLElement>('[data-kpi="net-cash-flow"]');
    if (!card) return;
    if (state.status === "error" || !state.data) {
      card.replaceChildren(errorState(state.error ?? { message: "现金流加载失败" }, () => loadNetCashFlow(period, true)));
      return;
    }
    const flow: CashFlowReport = state.data.data;
    if (reportPeriodErrors(flow, { from: range.from, to: range.to }).length > 0) {
      card.replaceChildren(errorState({ message: "净现金流期间不一致，已停止显示。" }, () => loadNetCashFlow(period, true)));
      return;
    }
    const link = card as HTMLAnchorElement;
    link.href = `#/cashflow?period=${period}&basis=consolidated`;
    link.setAttribute("aria-label", `净现金流，前往 ${period} 现金流`);
    card.replaceChildren(...valueMetricCard("净现金流", formatMoney(flow.net_cents), state.meta?.data_state, `${period} · 与现金流量表净额同源`, responseCompleteness(state.meta)).childNodes);
  };
  const loadRecent = async (force = false) => {
    const state = await queryClient.run(
      generation,
      queryKey({ ...sessionCacheKey(), resource: "recent-transactions" }),
      (requestSignal) => api.listTransactions({ limit: 6 }, { signal: requestSignal }),
      { ttlMs: 60_000, force },
    );
    if (state.status === "idle") return;
    if (state.status === "error" || !state.data) {
      if (!hasViewTransactions) setPanelError(recentPanel, state.error, () => loadRecent(true));
      return;
    }
    if (!hasViewTransactions) renderRecent(state.data.data);
  };
  function renderRecent(transactions: Transaction[]) {
    if (transactions.length === 0) {
      setPanelBody(recentPanel, emptyState("暂无交易", "当前账本没有可显示的最近交易。"));
      return;
    }
    setPanelBody(recentPanel, dataTable(["日期", "商户/备注", "类型", "金额"], transactions.slice(0, 6).map((t) => [
      formatDate(t.transaction_date), dataText(t.merchant_name ?? t.description ?? "—"), txnTypeLabel(t.transaction_type),
      transactionAmountLabel(t),
    ])), true);
    recentPanel.querySelector(".panel__body")?.append(el("p", { className: "cell-muted transaction-direction-note", textContent: "交易方向优先来自服务端 display_effect；旧响应回退 flow_effect。N/A 不按交易类型猜测。" }));
  }
  await Promise.all([loadMetrics(), loadView(), loadTrend()]);
  if (viewFailed && !hasViewTransactions) {
    recentPanel.querySelector(".panel__body")?.prepend(el("div", { className: "cell-muted panel-inline-note", textContent: "以下为独立交易接口数据；总览读模型暂不可用。" }));
  }
}

export function metricCard(label: string, m: MetricResult | undefined, format: "money" | "ratio", drill?: string, secondary?: MetricResult): HTMLElement {
  const value = format === "money" ? formatMoney(m?.value_cents ?? null) : formatRatio(m?.value ?? null);
  const reason = m?.na_reason ?? (m ? undefined : "服务端未提供此指标");
  const inner = [
    el("div", { className: "metric-card__label", textContent: label }),
    el("div", { className: "metric-card__value", textContent: value }),
    el("div", { className: "metric-card__meta" }, [
      el("span", { className: dataStateBadgeClass(m?.data_state), textContent: dataStateLabel(m?.data_state) }),
      metricPartialBadge(m),
      el("span", { textContent: reason ?? m?.period ?? m?.as_of ?? "" }),
      ...(secondary ? [el("span", { className: "metric-card__delta", textContent: secondary.metric_id === "net_worth_change" ? `月度变化 ${secondary.value_cents == null ? "N/A · 服务端未提供" : formatMoney(secondary.value_cents)}` : `口径 C（含偿债本金）${formatRatio(secondary.value)}` })] : []),
    ]),
  ];
  if (!drill) return el("div", { className: "metric-card" }, inner);
  // Drill-down carries the metric's as-of period into the target page (PRD 6.2).
  const period = m?.period ?? (m?.as_of ? m.as_of.slice(0, 7) : undefined);
  const dateRange = period ? monthRange(period) : null;
  const href = dateRange ? `#/${drill}?from=${dateRange.from}&to=${dateRange.to}&period=${period}` : `#/${drill}`;
  const a = el("a", { className: "metric-card metric-card--link", href, role: "link", "aria-label": `${label}，前往${drill}页` }, inner);
  return a;
}

function widgetPlaceholder(title: string, phase: string): HTMLElement {
  return el("section", { className: "panel panel--placeholder", "aria-label": `${title}后续阶段占位` }, [
    el("div", { className: "widget-placeholder" }, [
      el("span", { className: "cell-muted", textContent: title }),
      el("span", { className: "badge badge--neutral", textContent: `${phase} · 尚未接入` }),
    ]),
  ]);
}
