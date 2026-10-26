import type { Portfolio, Position } from "@wealthos/api-client";
import { api } from "../data/store";
import { normalizeQueryError } from "../data/query";
import { el } from "../components/dom";
import { donutChart } from "../components/lazy-charts";
import { emptyState, errorState, skeleton } from "../components/states";
import { panel, setPanelBody } from "../components/page";
import { formatMoney, formatSignedMoney } from "../presentation/format";
import { pageHeading, type PageContext } from "./flows";
import { metricGrid, metricSkeletons, moneyCell, table, valueMetricCard } from "./page-primitives";
import { instrumentIndex, positionInstrument } from "../domain/investments";
import { responseCompleteness } from "../domain/response-meta";
import { dataText } from "../app/locale";

function validPortfolio(portfolio: Portfolio | undefined): boolean {
  return Boolean(portfolio && typeof portfolio.as_of === "string" && Number.isSafeInteger(portfolio.market_value_cents)
    && Number.isSafeInteger(portfolio.cost_basis_cents) && Number.isSafeInteger(portfolio.unrealized_pnl_cents) && Array.isArray(portfolio.positions));
}

export async function renderInvestments({ root, signal }: PageContext): Promise<void> {
  pageHeading(root, "投资", "投资组合值多少，风险集中在哪里");
  const grid = metricGrid(metricSkeletons(4));
  const allocationPanel = panel("持仓权重", skeleton(240));
  const listPanel = panel("持仓明细", skeleton(200), true);
  const notice = el("div");
  root.append(grid, notice, allocationPanel, listPanel);

  const loadPortfolio = async () => {
    try {
      const res = await api.getPortfolio({ signal });
      if (signal.aborted) return;
      const portfolio = res.data;
      if (!validPortfolio(portfolio)) {
        grid.replaceChildren(...["总市值", "成本", "未实现盈亏", "已实现收益"].map((label) => valueMetricCard(label, "N/A", undefined, "汇总暂不可用")));
        notice.replaceChildren(errorState({ message: "组合汇总暂不可用：服务端 Portfolio 缺 as_of、成本或 positions；不从持仓列表自行拼算。" }, loadPortfolio));
        return;
      }
      notice.replaceChildren();
      grid.replaceChildren(
        valueMetricCard("总市值", formatMoney(portfolio.market_value_cents), res.meta?.data_state, `as of ${portfolio.as_of}`, responseCompleteness(res.meta)),
        valueMetricCard("成本", formatMoney(portfolio.cost_basis_cents), res.meta?.data_state, undefined, responseCompleteness(res.meta)),
        valueMetricCard("未实现盈亏", formatSignedMoney(portfolio.unrealized_pnl_cents), res.meta?.data_state, undefined, responseCompleteness(res.meta)),
        valueMetricCard("已实现收益", portfolio.realized_pnl_cents == null ? "N/A" : formatSignedMoney(portfolio.realized_pnl_cents), res.meta?.data_state, portfolio.realized_pnl_cents == null ? "服务端未提供" : undefined, responseCompleteness(res.meta)),
      );
      renderPositions(portfolio.positions);
    } catch (error) {
      if (!signal.aborted) notice.replaceChildren(errorState(normalizeQueryError(error), loadPortfolio));
    }
  };
  const loadPositions = async () => {
    setPanelBody(listPanel, skeleton(200), true);
    try {
      const res = await api.listPositions({ signal });
      if (signal.aborted) return;
      renderPositions(res.data);
    } catch (error) {
      if (!signal.aborted) setPanelBody(listPanel, errorState(normalizeQueryError(error), loadPositions));
    }
  };
  let instruments = instrumentIndex([]);
  let latestPositions: Position[] | null = null;
  let instrumentsReady = false;
  const renderPositions = async (positions: Position[]) => {
    latestPositions = positions;
    if (!instrumentsReady) {
      setPanelBody(listPanel, skeleton(200), true);
      return;
    }
    if (signal.aborted) return;
    const allocation = positions.length === 0 ? emptyState("暂无持仓", "没有投资持仓记录。")
      : await donutChart(positions.filter((position): position is Position & { market_value_cents: number } => position.market_value_cents != null).map((position) => ({
        name: position.instrument_name ?? positionInstrument(position, instruments)?.name ?? position.instrument_id.slice(0, 8), value: position.market_value_cents / 100,
      })), { title: "持仓市值权重", description: "仅绘制有市值的持仓；权重不代表服务端组合汇总。", source: "/positions", timeRange: "当前已返回持仓" });
    if (signal.aborted) return;
    setPanelBody(allocationPanel, allocation);
    setPanelBody(listPanel, positions.length === 0 ? emptyState("暂无持仓", "没有投资持仓记录。") : table(
      ["标的", "类型", "数量", "成本价", "最新价", "行情日期/来源", "市值", "未实现盈亏"], positions.map((position) => [
        dataText(position.instrument_name ?? positionInstrument(position, instruments)?.name ?? position.instrument_id.slice(0, 8)),
        dataText(positionInstrument(position, instruments)?.asset_class ?? "N/A"), String(position.quantity),
        moneyCell(formatMoney(position.average_cost_cents)), moneyCell(formatMoney(position.latest_price_cents ?? null)),
        el("span", { className: "cell-muted", textContent: position.latest_price_as_of ? `${position.latest_price_as_of} · ${position.latest_price_source ?? "来源未提供"}` : position.na_reason ?? "N/A" }),
        el("span", { title: position.na_reason ?? undefined }, [moneyCell(formatMoney(position.market_value_cents))]), moneyCell(formatSignedMoney(position.unrealized_pnl_cents ?? null)),
      ]),
    ), true);
  };
  const loadInstruments = async () => {
    try {
      const res = await api.listInstruments({ signal });
      if (!signal.aborted) instruments = instrumentIndex(res.data);
    } catch { /* Optional labels retain their ids and N/A type when unavailable. */ }
    finally {
      instrumentsReady = true;
      if (!signal.aborted && latestPositions) await renderPositions(latestPositions);
    }
  };
  await Promise.all([loadInstruments(), loadPortfolio(), loadPositions()]);
}
