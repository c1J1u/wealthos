import { api } from "../data/store";
import { emptyState, errorState } from "../components/states";
import { panel, setPanelBody } from "../components/page";
import { formatDate, formatMoney, formatTransactionMoney, txnTypeLabel } from "../presentation/format";
import { dataTable } from "../components/table";
import { historyRange, monthRange } from "../domain/period";
import { loadMetricTrend } from "../components/metric-trend";
import { filterFailure, settlementFilterErrors } from "../domain/transactions";
import {
  categoryLabeler, flowPageContext, loadMetrics, loadTransactionPanel,
  periodPicker, tabBar, transactionTable, type PageContext,
} from "./flows";
import { loadFlowView } from "./flows";
import { incomeStabilityView } from "../components/view-read-models";
import { skeleton } from "../components/states";
import { defaultBusinessPeriod } from "../app/session";
import { viewPeriodErrors } from "../domain/view-models";
import { dataText } from "../app/locale";

export async function renderIncome(ctx: PageContext): Promise<void> {
  const { root, signal, params, period, range, grid, breakdown, trend, composition, summary, listHolder } = flowPageContext(ctx, "income");
  const meta = await api.getMeta({ signal }).catch(() => null);
  const activePeriod = period || (meta ? defaultBusinessPeriod(meta.data) : "");
  const activeRange = range ?? monthRange(activePeriod);
  let activeTab = ["recurring", "settlement"].includes(params?.get("tab") ?? "") ? params!.get("tab")! : "overview";
  let label = categoryLabeler([]);
  const listPanel = listHolder;
  const tabs = tabBar([
    { id: "overview", label: "收入流水" },
    { id: "recurring", label: "经常性收入" },
    { id: "settlement", label: "结算款" },
  ], activeTab, (id) => { activeTab = id; void drawList(); });
  root.append(tabs, periodPicker(activePeriod, "income", "收入期间"), grid, breakdown, summary, listPanel);

  const categories = api.listCategories({ kind: "INCOME" }, { signal }).then((res) => {
    label = categoryLabeler(res.data);
  }).catch(() => { /* Codes remain visible if the optional name lookup fails. */ });

  async function drawList() {
    listPanel.replaceChildren();
    if (activeTab === "recurring") {
      const target = panel("经常性收入", skeleton(160));
      listPanel.append(target);
      try {
        const response = await api.getView("income", activePeriod ? { period: activePeriod } : {}, { signal });
        if (viewPeriodErrors(activePeriod, response.meta.period).length > 0) throw new Error("服务端收入视图期间与请求不一致，已停止展示。");
        if (!signal.aborted) setPanelBody(target, incomeStabilityView(response.data.income_stability));
      } catch {
        if (!signal.aborted) setPanelBody(target, errorState({ message: "收入稳定性暂不可用，请重试。" }, drawList));
      }
      return;
    }
    if (activeTab === "settlement") {
      const target = panel("结算款", emptyState("正在加载", ""));
      listPanel.append(target);
      const [refunds, reimbursements] = await Promise.all([
        api.listTransactions({ type: "REFUND", limit: 100, ...activeRange }, { signal }).catch(() => null),
        api.listTransactions({ type: "REIMBURSEMENT", limit: 100, ...activeRange }, { signal }).catch(() => null),
      ]);
      if (signal.aborted) return;
      if (!refunds || !reimbursements) { setPanelBody(target, errorState({ message: "结算款暂不可用；请重试，不计入本期收入。" }, drawList)); return; }
      const items = [...refunds.data, ...reimbursements.data].sort((a, b) => b.transaction_date.localeCompare(a.transaction_date));
      const ignored = settlementFilterErrors(refunds.data, reimbursements.data, activeRange ?? {});
      if (ignored.length > 0) { setPanelBody(target, errorState(filterFailure(ignored))); return; }
      setPanelBody(target, items.length === 0 ? emptyState("暂无结算款", "退款、报销与结算不计入收入；本期没有此类记录。")
        : dataTable(["日期", "说明", "类型", "金额"], items.map((t) => [
          formatDate(t.transaction_date), dataText(t.merchant_name ?? t.description ?? "—"), txnTypeLabel(t.transaction_type),
          formatTransactionMoney(t.amount_cents, "income", t.currency),
        ])), true);
      return;
    }
    const target = panel("收入流水", emptyState("正在加载", ""), false, true, "income-transactions");
    listPanel.append(target);
    await loadTransactionPanel(target, { type: "INCOME", ...activeRange }, signal, (items) => {
      setPanelBody(target, items.length === 0
        ? emptyState("暂无收入流水", `${activePeriod || "当前期间"} 没有收入记录，未使用历史流水代替。`)
        : transactionTable(items, label), true);
    });
  }

  await Promise.all([
    loadMetrics(grid, ["monthly_total_income"], { monthly_total_income: "本期收入" }, activePeriod, signal),
    loadMetricTrend(api, trend, "monthly_total_income", "月收入趋势", activeRange ? historyRange("6m", activeRange.to) : null, signal),
    loadFlowView("income", activePeriod, signal, { composition, summary, breakdown }),
    categories.then(drawList),
  ]);
}
