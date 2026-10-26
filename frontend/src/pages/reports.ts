import type { BalanceSheetReport, CashFlowReport, IncomeStatementReport } from "@wealthos/api-client";
import { api, queryClient } from "../data/store";
import { normalizeQueryError, queryKey } from "../data/query";
import { sessionCacheKey } from "../app/session";
import { isDate, isPeriod, monthRange } from "../domain/period";
import { reportPeriodErrors } from "../domain/reports";
import { el } from "../components/dom";
import { emptyState, errorState, partialState, skeleton } from "../components/states";
import { panel, setPanelBody } from "../components/page";
import { dataStateLabel, formatMoney, formatSignedMoney } from "../presentation/format";
import { pageHeading, type PageContext } from "./flows";
import { metricGrid, moneyCell, table, valueMetricCard } from "./page-primitives";
import { responseCompleteness } from "../domain/response-meta";
import { defaultBusinessPeriod } from "../app/session";
import { dataText } from "../app/locale";

export async function renderReports({ root, signal, params }: PageContext): Promise<void> {
  pageHeading(root, "报表", "资产负债表、收支表和现金流量表是否对得上");
  const generation = queryClient.nextGeneration();
  const meta = await api.getMeta({ signal }).catch(() => null);
  const period = isPeriod(params?.get("period")) ? params!.get("period")! : meta ? defaultBusinessPeriod(meta.data) : "";
  const asOf = isDate(params?.get("as_of")) ? params!.get("as_of")! : meta?.data.today ?? "";
  const range = monthRange(period);
  const picker = el("form", { className: "filter-bar rise rise-1", style: "margin-bottom: 1rem" });
  const asOfInput = el("input", { type: "date", lang: "zh-CN", value: asOf, "aria-label": "资产负债表 as-of", required: true });
  const periodInput = el("input", { type: "month", lang: "zh-CN", value: period, "aria-label": "收支/现金期间", required: true });
  const apply = el("button", { className: "button", textContent: "应用" });
  picker.append(el("span", { className: "cell-muted", textContent: "as-of" }), asOfInput,
    el("span", { className: "cell-muted", textContent: "期间" }), periodInput, apply);
  picker.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!isDate(asOfInput.value) || !isPeriod(periodInput.value)) {
      asOfInput.setCustomValidity(isDate(asOfInput.value) ? "" : "请选择有效日期");
      periodInput.setCustomValidity(isPeriod(periodInput.value) ? "" : "请选择有效月份");
      picker.reportValidity();
      return;
    }
    location.hash = `#/reports?as_of=${asOfInput.value}&period=${periodInput.value}`;
  });
  const bsPanel = panel(`资产负债表 · as of ${asOf || "—"}`, skeleton(200), true);
  const isPanel = panel(`收支表 · ${period || "—"}`, skeleton(200), true);
  const cfPanel = panel(`现金流量表 · ${period || "—"}`, skeleton(120));
  const snapshotPanel = panel("快照对比", skeleton(120), true);
  snapshotPanel.style.marginTop = "1rem";
  cfPanel.style.marginTop = "1rem";
  root.append(picker, el("div", { className: "grid-2" }, [bsPanel, isPanel]), cfPanel, snapshotPanel);

  const periodFailure = (errors: string[]) => errors.length > 0
    ? { message: `服务端报表与请求不一致（${errors.join("、")}）；已停止展示，避免误用其他期间的数据。` }
    : null;

  const loadBalanceSheet = async (force = false) => {
    setPanelBody(bsPanel, skeleton(200), true);
    const state = await queryClient.run(generation, queryKey({ ...sessionCacheKey(), resource: "balance-sheet", asOf }), (requestSignal) =>
      api.getBalanceSheet({ as_of: asOf || undefined }, { signal: requestSignal }), { force });
    if (state.status === "idle") return;
    if (state.status === "error" || !state.data) { setPanelBody(bsPanel, errorState(state.error ?? { message: "资产负债表加载失败" }, () => loadBalanceSheet(true))); return; }
    const report: BalanceSheetReport = state.data.data;
    const mismatch = periodFailure(reportPeriodErrors(report, { asOf: asOf || undefined }));
    if (mismatch) { setPanelBody(bsPanel, errorState(mismatch, () => loadBalanceSheet(true))); return; }
    const totals = [
      ["总资产", moneyCell(formatMoney(report.total_assets_cents))],
      ["总负债", moneyCell(formatMoney(report.total_liabilities_cents))],
      ["净资产", moneyCell(formatMoney(report.net_worth_cents))],
    ];
    if (!Array.isArray(report.rows)) {
      setPanelBody(bsPanel, el("div", {}, [errorState({ message: "行明细缺少 rows；以下仅为服务端汇总，不由前端补造明细。" }, () => loadBalanceSheet(true)), table(["汇总项目", "金额", "数据态"], totals.map(([label, value]) => [label as string, value as Node, dataStateLabel(state.meta?.data_state)]))]));
      return;
    }
    setPanelBody(bsPanel, el("div", {}, [
      report.excluded_assets?.length ? partialState(report.excluded_assets.length, "服务端排除的资产") : "",
      reportCompleteness(state.meta),
      table(["科目", "金额", "数据态"], [
        ...report.rows.map((row) => [dataText(row.label), moneyCell(formatMoney(row.amount_cents)), dataStateLabel(row.data_state)]),
        ...totals.map(([label, value]) => [label as string, value as Node, dataStateLabel(state.meta?.data_state)]),
      ]),
    ]), true);
  };

  const loadIncomeStatement = async (force = false) => {
    setPanelBody(isPanel, skeleton(200), true);
    const state = await queryClient.run(generation, queryKey({ ...sessionCacheKey(), resource: "income-statement", period }), (requestSignal) =>
      api.getIncomeStatement({ period: period || undefined }, { signal: requestSignal }), { force });
    if (state.status === "idle") return;
    if (state.status === "error" || !state.data) { setPanelBody(isPanel, errorState(state.error ?? { message: "收支表加载失败" }, () => loadIncomeStatement(true))); return; }
    const report: IncomeStatementReport = state.data.data;
    const mismatch = periodFailure(reportPeriodErrors(report, { period: period || undefined }));
    if (mismatch) { setPanelBody(isPanel, errorState(mismatch, () => loadIncomeStatement(true))); return; }
    const rows = [
      ["收入", report.income_cents], ["必要支出", report.essential_cents], ["非必要支出", report.discretionary_cents],
      ["财务成本", report.financial_cost_cents], ["退款冲减", report.refund_reversal_cents], ["净支出", report.expense_cents],
    ] as const;
    if (!Array.isArray(report.rows)) {
      setPanelBody(isPanel, el("div", {}, [
        errorState({ message: "行明细缺少 rows；以下仅为服务端汇总，不由前端补造明细。" }, () => loadIncomeStatement(true)),
        table(["汇总项目", "金额", "数据态"], [
          ["收入", moneyCell(formatMoney(report.income_cents)), dataStateLabel(state.meta?.data_state)], ["净支出", moneyCell(formatMoney(report.expense_cents)), dataStateLabel(state.meta?.data_state)], ["本期净额", moneyCell(formatSignedMoney(report.net_cents)), dataStateLabel(state.meta?.data_state)],
        ]),
      ]));
      return;
    }
    setPanelBody(isPanel, table(["项目", "金额", "数据态"], [
      ...rows.map(([label, value]) => [label, moneyCell(formatMoney(value)), dataStateLabel(state.meta?.data_state)]),
      ...report.rows.map((row) => [dataText(row.label), moneyCell(formatMoney(row.amount_cents)), dataStateLabel(row.data_state ?? state.meta?.data_state)]),
      ["本期净额", moneyCell(formatSignedMoney(report.net_cents)), dataStateLabel(state.meta?.data_state)],
    ]), true);
    if (state.meta?.partial || (state.meta?.missing_count ?? 0) > 0) isPanel.querySelector(".panel__body")?.prepend(reportCompleteness(state.meta));
  };

  const loadCashFlow = async (force = false) => {
    setPanelBody(cfPanel, skeleton(120));
    const state = await queryClient.run(generation, queryKey({ ...sessionCacheKey(), resource: "cash-flow", period }), (requestSignal) =>
      api.getCashFlow(range ? { from: range.from, to: range.to } : {}, { signal: requestSignal }), { force });
    if (state.status === "idle") return;
    if (state.status === "error" || !state.data) { setPanelBody(cfPanel, errorState(state.error ?? { message: "现金流量表加载失败" }, () => loadCashFlow(true))); return; }
    const report: CashFlowReport = state.data.data;
    const mismatch = periodFailure(reportPeriodErrors(report, { from: range?.from, to: range?.to }));
    if (mismatch) { setPanelBody(cfPanel, errorState(mismatch, () => loadCashFlow(true))); return; }
    setPanelBody(cfPanel, el("div", { className: "stack" }, [
      metricGrid([
        valueMetricCard("经营", formatSignedMoney(report.operating_cents), state.meta?.data_state, undefined, responseCompleteness(state.meta)),
        valueMetricCard("投资", formatSignedMoney(report.investing_cents), state.meta?.data_state, undefined, responseCompleteness(state.meta)),
        valueMetricCard("筹资", formatSignedMoney(report.financing_cents), state.meta?.data_state, undefined, responseCompleteness(state.meta)),
        valueMetricCard("净额", formatSignedMoney(report.net_cents), state.meta?.data_state, undefined, responseCompleteness(state.meta)),
      ]),
      reportCompleteness(state.meta),
      el("div", { className: "cell-muted", textContent: `${report.from_date} 至 ${report.to_date} · ${report.note ?? "服务端未提供口径说明"}` }),
      el("div", { className: "cell-muted", textContent: `数据态 ${dataStateLabel(state.meta?.data_state)} · request ${state.meta?.request_id ?? "N/A"}` }),
    ]));
  };

  const loadSnapshots = async () => {
    setPanelBody(snapshotPanel, skeleton(120), true);
    try {
      const res = await api.listSnapshots(range ? { from: range.from, to: range.to } : {}, { signal });
      if (signal.aborted) return;
      const snapshots = [...res.data].sort((a, b) => b.as_of.localeCompare(a.as_of)).slice(0, 6);
      setPanelBody(snapshotPanel, snapshots.length === 0 ? emptyState("暂无快照", "当前服务没有可比较的财务快照。") : table(
        ["as-of", "净资产", "总资产", "总负债", "数据/公式"], snapshots.map((snapshot) => [
          snapshot.as_of, moneyCell(formatMoney(snapshot.net_worth_cents)), moneyCell(formatMoney(snapshot.total_assets_cents)),
          moneyCell(formatMoney(snapshot.total_liabilities_cents)),
          `${dataStateLabel(res.meta?.data_state)} / ${snapshot.formula_version}`,
        ]),
      ), true);
    } catch (error) {
      if (!signal.aborted) setPanelBody(snapshotPanel, errorState(normalizeQueryError(error), loadSnapshots));
    }
  };
  await Promise.all([loadBalanceSheet(), loadIncomeStatement(), loadCashFlow(), loadSnapshots()]);
}

function reportCompleteness(meta: { partial?: boolean; missing_count?: number } | undefined): HTMLElement | "" {
  return meta?.partial || (meta?.missing_count ?? 0) > 0 ? partialState(meta?.missing_count ?? 0, "服务端报表投影") : "";
}
