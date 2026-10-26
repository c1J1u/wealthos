import type { Asset } from "@wealthos/api-client";
import { api } from "../data/store";
import { getMetricBundle } from "../data/metrics";
import { normalizeQueryError } from "../data/query";
import { el } from "../components/dom";
import { emptyState, errorState, skeleton } from "../components/states";
import { panel, setPanelBody } from "../components/page";
import { dataStateBadgeClass, dataStateLabel, formatMoney } from "../presentation/format";
import { pageHeading, type PageContext } from "./flows";
import { metricGrid, metricSkeletons, moneyCell, table, valueMetricCard } from "./page-primitives";
import { openDrawer } from "../components/drawer";
import { lineChart } from "../components/lazy-charts";
import { valuationContractErrors } from "../domain/assets";
import { responseCompleteness } from "../domain/response-meta";
import { dataText } from "../app/locale";

export async function renderAssets({ root, signal }: PageContext): Promise<void> {
  pageHeading(root, "资产", "拥有什么，估值是什么时候的，是否计入净资产");
  const grid = metricGrid(metricSkeletons(3));
  const listPanel = panel("资产台账", skeleton(240), true);
  root.append(grid, listPanel);

  const loadMetrics = async () => {
    try {
      const res = await getMetricBundle(api, ["total_assets", "liquid_assets"], {}, { signal });
      if (signal.aborted) return;
      const metrics = new Map(res.metrics.map((metric) => [metric.metric_id, metric]));
      grid.replaceChildren(
        valueMetricCard("总资产", formatMoney(metrics.get("total_assets")?.value_cents ?? null), metrics.get("total_assets")?.data_state, "含账户、持仓及纳入口径的资产", responseCompleteness(res.meta, metrics.get("total_assets"))),
        valueMetricCard("流动资产", formatMoney(metrics.get("liquid_assets")?.value_cents ?? null), metrics.get("liquid_assets")?.data_state, "服务端未提供此指标", responseCompleteness(res.meta, metrics.get("liquid_assets"))),
        valueMetricCard("非账户资产估值", "N/A", undefined, "当前接口未提供估值汇总"),
      );
    } catch (error) {
      if (!signal.aborted) grid.replaceChildren(errorState(normalizeQueryError(error), loadMetrics));
    }
  };

  const loadAssets = async () => {
    setPanelBody(listPanel, skeleton(240), true);
    try {
      const res = await api.listAssets({ signal });
      if (signal.aborted) return;
      const assets = res.data;
      const content = assets.length === 0 ? emptyState("暂无资产", "没有非账户资产台账记录；账户与持仓不在此重复计算。") : table(
        ["资产", "类型", "单项市值", "估值日期", "来源", "流动性/受限", "指标处理", "数据"],
        assets.map((asset: Asset) => [
          dataText(asset.name), dataText(asset.asset_type), moneyCell(formatMoney(asset.latest_market_value_cents, asset.currency)),
          dataText(asset.valuation_date ?? "N/A"), dataText(asset.valuation_source ?? "—"),
          `${asset.liquidity_level ?? "N/A"} / ${asset.is_restricted ? "受限" : "非受限"}`,
          asset.valuation_date ? "由服务端指标决定" : "缺日期 · 未计入指标",
          el("span", { className: dataStateBadgeClass(asset.data_state), textContent: dataStateLabel(asset.data_state) }),
        ]),
      );
      content.querySelectorAll<HTMLTableRowElement>("tbody tr").forEach((row, index) => {
        row.tabIndex = 0;
        row.setAttribute("aria-label", `查看${assets[index]!.name}估值历史`);
        const open = () => { void openAssetValuations(assets[index]!, signal); };
        row.addEventListener("click", open);
        row.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); open(); } });
      });
      setPanelBody(listPanel, content, true);
    } catch (error) {
      if (!signal.aborted) setPanelBody(listPanel, errorState(normalizeQueryError(error), loadAssets));
    }
  };
  await Promise.all([loadMetrics(), loadAssets()]);
}

async function openAssetValuations(asset: Asset, pageSignal: AbortSignal): Promise<void> {
  const handle = openDrawer({ title: asset.name, label: `${asset.name}估值历史`, rawTitle: true });
  const signal = AbortSignal.any([pageSignal, handle.signal]);
  const summary = el("dl", { className: "kv" }, [
    el("dt", { textContent: "当前市值" }), el("dd", { textContent: formatMoney(asset.latest_market_value_cents, asset.currency) }),
    el("dt", { textContent: "最新估值日期" }), el("dd", { textContent: asset.valuation_date ?? "N/A" }),
  ]);
  handle.body.append(summary, skeleton(180));
  const historyHolder = handle.body.lastElementChild as HTMLElement;

  const load = async () => {
    if (signal.aborted || handle.closed) return;
    historyHolder.replaceChildren(skeleton(180));
    try {
      const res = await api.listAssetValuations(asset.asset_id, {}, { signal });
      if (signal.aborted || handle.closed) return;
      const errors = valuationContractErrors(asset.asset_id, res.data);
      if (errors.length > 0) throw Object.assign(new Error(`估值历史响应与资产不一致（${errors.join("、")}）；已停止绘制。`), { problem: { code: "INVALID_RESPONSE", request_id: res.meta.request_id } });
      const valuations = [...res.data].sort((a, b) => a.as_of.localeCompare(b.as_of));
      const content = valuations.length === 0 ? emptyState("暂无估值历史", "服务端没有该资产的估值记录；当前市值不会复制成历史点。") : el("div", { className: "stack" }, [
        await lineChart(valuations.map((item) => ({ x: item.as_of, y: item.market_value_cents / 100 })), {
          title: `${asset.name}估值历史`, description: "服务端估值记录；N/A 不从当前市值补点。", source: `/assets/${asset.asset_id}/valuations`, timeRange: "全部已返回估值历史", formatY: (value) => `¥${value.toLocaleString("zh-CN", { maximumFractionDigits: 0 })}`,
        }),
        table(["估值日期", "市值", "成本", "未实现收益", "来源"], [...valuations].reverse().map((item) => [
          item.as_of, moneyCell(formatMoney(item.market_value_cents, asset.currency)),
          moneyCell(formatMoney(item.cost_basis_cents ?? null, asset.currency)),
          moneyCell(formatMoney(item.unrealized_gain_loss_cents ?? null, asset.currency)), item.source,
        ])),
      ]);
      historyHolder.replaceChildren(content);
    } catch (error) {
      if (!signal.aborted && !handle.closed) {
        historyHolder.replaceChildren(errorState(normalizeQueryError(error), load, { onReturn: handle.close }));
      }
    }
  };
  await load();
}
