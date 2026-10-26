import type { ViewPayload } from "@wealthos/api-client";
import { el } from "./dom";
import { donutChart } from "./lazy-charts";
import { dataTable } from "./table";
import { emptyState } from "./states";
import { formatMoney, formatRatio, dataStateBadgeClass, dataStateLabel } from "../presentation/format";
import { compositionErrors, regularityRows, stabilityRows, transactionSummaryRows } from "../domain/view-models";
import { dataText } from "../app/locale";

export async function compositionView(composition: ViewPayload["composition"], source: string): Promise<HTMLElement> {
  if (compositionErrors(composition).length > 0) {
    return emptyState("构成数据暂不可用", "服务端未提供完整命名分组与合法占比；不按流水或账户列表拼算。");
  }
  if (composition!.length === 0) return emptyState("暂无构成数据", "当前期间没有服务端分组记录，未补 0。");
  return el("div", {}, [
    await donutChart(composition!.map((row) => ({ name: row.label, value: Math.abs(row.amount_cents) / 100 })), {
      title: "服务端构成", description: "分组与金额来自服务端读模型；占比仅作展示。", source, timeRange: "当前读模型期间",
    }),
    dataTable(["分组", "金额", "占比", "数据态"], composition!.map((row) => [
      dataText(row.label), el("span", { className: "cell-money", textContent: formatMoney(row.amount_cents) }),
      row.share == null ? "N/A" : formatRatio(row.share), el("span", { className: dataStateBadgeClass(row.data_state), textContent: dataStateLabel(row.data_state) }),
    ])),
  ]);
}

export function incomeStabilityView(value: ViewPayload["income_stability"]): HTMLElement {
  if (!value) return emptyState("收入稳定性暂不可用", "需要服务端 recurring 与来源集中度；不从分类猜工资或固定收入。");
  return dataTable(["项目", "服务端值"], stabilityRows(value).map(([label, value]) => [
    label, label.includes("占比") ? formatRatio(value as number | null) : label.includes("金额") || label.includes("收入") ? formatMoney(value as number | null) : value == null ? "N/A" : label === "最大来源" ? dataText(String(value)) : String(value),
  ]));
}

export function expenseRegularityView(value: ViewPayload["expense_regularity"]): HTMLElement {
  if (!value) return emptyState("固定支出与报销暂不可用", "需要服务端 recurrence/frequency 与报销回款 projection；不按分类猜固定支出。");
  return dataTable(["项目", "金额"], regularityRows(value).map(([label, value]) => [label, formatMoney(typeof value === "number" ? value : null)]));
}

export function transactionSummaryView(value: ViewPayload["summary"]): HTMLElement {
  if (!value) return emptyState("流水汇总暂不可用", "需要当前筛选范围的服务端汇总；不把当前页当全量。");
  const scope = value.scope;
  const period = value.period ?? (scope?.from || scope?.to ? `${scope.from ?? "最早"} 至 ${scope.to ?? "最近"}` : "全账本（未限定期间）");
  const filters = [scope?.type, scope?.account_id ? `账户 ${scope.account_id}` : null, scope?.category_code, scope?.status, scope?.reconciliation ? `对账 ${scope.reconciliation}` : null, scope?.data_state ? `数据态 ${scope.data_state}` : null, scope?.q ? `搜索 ${scope.q}` : null].filter(Boolean).join(" · ");
  return el("div", {}, [
    el("p", { className: "cell-muted", textContent: `汇总范围：${period}${filters ? ` · ${filters}` : ""}${scope?.first_month ? ` · 数据 ${scope.first_month} 至 ${scope.last_month}` : ""}` }),
    dataTable(["项目", "服务端值"], transactionSummaryRows(value).map(([label, value]) => [
    label, label === "流水笔数" ? value == null ? "N/A" : String(value) : formatMoney(typeof value === "number" ? value : null),
    ])),
  ]);
}
