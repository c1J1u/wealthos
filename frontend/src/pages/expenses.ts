import { api } from "../data/store";
import { emptyState, skeleton } from "../components/states";
import { setPanelBody } from "../components/page";
import {
  categoryLabeler, flowPageContext, loadMetrics, loadTransactionPanel,
  periodPicker, tabBar, transactionTable, type PageContext,
} from "./flows";
import { loadFlowView } from "./flows";
import { expenseRegularityView } from "../components/view-read-models";
import { historyRange, monthRange } from "../domain/period";
import { panel } from "../components/page";
import { loadMetricTrend } from "../components/metric-trend";
import { errorState } from "../components/states";
import { defaultBusinessPeriod } from "../app/session";
import { viewPeriodErrors } from "../domain/view-models";

export async function renderExpenses(ctx: PageContext): Promise<void> {
  const { root, signal, params, period, grid, breakdown, trend, composition, summary, listHolder } = flowPageContext(ctx, "expenses");
  const meta = await api.getMeta({ signal }).catch(() => null);
  const activePeriod = period || (meta ? defaultBusinessPeriod(meta.data) : "");
  const range = monthRange(activePeriod);
  let activeTab = ["fixed", "reimbursable"].includes(params?.get("tab") ?? "") ? params!.get("tab")! : "overview";
  let label = categoryLabeler([]);
  const tabs = tabBar([
    { id: "overview", label: "支出流水" },
    { id: "fixed", label: "固定/订阅" },
    { id: "reimbursable", label: "报销跟踪" },
  ], activeTab, (id) => { activeTab = id; void drawList(); });
  root.append(tabs, periodPicker(activePeriod, "expenses", "支出期间"), grid, breakdown, summary, listHolder);
  const categories = api.listCategories({ kind: "EXPENSE" }, { signal }).then((res) => { label = categoryLabeler(res.data); }).catch(() => {});

  async function drawList() {
    listHolder.replaceChildren();
    if (activeTab !== "overview") {
      const title = activeTab === "fixed" ? "固定/订阅支出" : "报销跟踪";
      const target = panel(title, skeleton(160));
      listHolder.append(target);
      try {
        const response = await api.getView("expenses", activePeriod ? { period: activePeriod } : {}, { signal });
        if (viewPeriodErrors(activePeriod, response.meta.period).length > 0) throw new Error("服务端支出视图期间与请求不一致，已停止展示。");
        if (!signal.aborted) setPanelBody(target, expenseRegularityView(response.data.expense_regularity));
      } catch {
        if (!signal.aborted) setPanelBody(target, errorState({ message: "支出结构暂不可用；不从当前页流水拼算。" }, drawList));
      }
      return;
    }
    const target = panel("支出流水", emptyState("正在加载", ""));
    listHolder.append(target);
    await loadTransactionPanel(target, { type: "EXPENSE", ...range }, signal, (items) => {
      setPanelBody(target, items.length === 0
        ? emptyState("暂无支出流水", `${activePeriod || "当前期间"} 没有支出记录，未使用历史流水代替。`)
        : transactionTable(items, label), true);
    });
  }

  await Promise.all([
    loadMetrics(grid, ["monthly_total_expense", "essential_expense", "discretionary_expense", "financial_cost"], {
      monthly_total_expense: "本期经济支出", essential_expense: "必要支出",
      discretionary_expense: "非必要支出", financial_cost: "财务成本",
    }, activePeriod, signal),
    loadMetricTrend(api, trend, "monthly_total_expense", "月经济支出趋势", range ? historyRange("6m", range.to) : null, signal),
    loadFlowView("expenses", activePeriod, signal, { composition, summary, breakdown }),
    categories.then(drawList),
  ]);
}
