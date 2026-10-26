import type { CashFlowReport } from "@wealthos/api-client";
import { api, queryClient } from "../data/store";
import { normalizeQueryError, queryKey } from "../data/query";
import { sessionCacheKey } from "../app/session";
import { isPeriod, monthRange } from "../domain/period";
import { reportPeriodErrors } from "../domain/reports";
import { el } from "../components/dom";
import { emptyState, errorState, skeleton } from "../components/states";
import { panel, setPanelBody } from "../components/page";
import { formatSignedMoney } from "../presentation/format";
import { pageHeading, periodPicker, type PageContext } from "./flows";
import { metricGrid, metricSkeletons, valueMetricCard } from "./page-primitives";
import { disclosure } from "../components/disclosure";
import { cashflowBasisUnavailable } from "./cashflow-state";
import { routeWithParams } from "../app/route-state";
import { responseCompleteness } from "../domain/response-meta";
import { dataText } from "../app/locale";
import { defaultBusinessPeriod } from "../app/session";

export async function renderCashflow({ root, signal, params }: PageContext): Promise<void> {
  pageHeading(root, "现金流", "现金为什么变化，和净资产变化差在哪里");
  const generation = queryClient.nextGeneration();
  const meta = await api.getMeta({ signal }).catch(() => null);
  const requested = params?.get("period");
  const period = isPeriod(requested) ? requested : meta ? defaultBusinessPeriod(meta.data) : "";
  const range = monthRange(period);
  const tabs = el("div", { className: "segmented rise rise-1", role: "group", "aria-label": "现金流口径" });
  const grid = metricGrid(metricSkeletons(4));
  const notePanel = panel("现金流说明", skeleton(80));
  let basis = params?.get("basis") === "per-account" ? "per-account" : "consolidated";
  let accountId = params?.get("account_id") ?? "";
  const accountSelect = el("select", { "aria-label": "现金流账户" }, [el("option", { value: "", textContent: "选择账户" })]);
  const accountPicker = el("div", { className: "filter-bar rise rise-1", hidden: basis !== "per-account" }, [accountSelect]);
  root.append(tabs, periodPicker(period, "cashflow", "现金流期间"), accountPicker, grid, notePanel);
  const accountsPromise = api.listAccounts({ limit: 200 }, { signal }).then((response) => {
    for (const account of response.data) accountSelect.append(el("option", { value: account.account_id, ...(account.account_id === accountId ? { selected: true } : {}) }, [dataText(account.name)]));
  }).catch(() => undefined);
  accountSelect.addEventListener("change", () => {
    accountId = accountSelect.value;
    history.replaceState(null, "", routeWithParams(location.hash, { account_id: accountId }));
    if (basis === "per-account") void loadCashFlow(true);
  });

  for (const definition of [{ id: "consolidated", label: "合并抵消" }, { id: "per-account", label: "单账户" }]) {
    const button = el("button", { textContent: definition.label, "aria-pressed": String(definition.id === basis) });
    button.addEventListener("click", () => {
      basis = definition.id;
      history.replaceState(null, "", routeWithParams(location.hash, { basis }));
      tabs.querySelectorAll("button").forEach((item) => item.setAttribute("aria-pressed", String(item === button)));
      accountPicker.hidden = basis !== "per-account";
      if (basis === "per-account") {
        grid.replaceChildren(...metricSkeletons(4));
        void loadCashFlow(true);
      } else void loadCashFlow();
    });
    tabs.append(button);
  }

  async function loadCashFlow(force = false) {
    setPanelBody(notePanel, skeleton(80));
    if (basis === "per-account") {
      await accountsPromise;
      if (!accountId) {
        grid.replaceChildren();
        setPanelBody(notePanel, cashflowBasisUnavailable());
        return;
      }
    }
    const state = await queryClient.run(generation, queryKey({ ...sessionCacheKey(), resource: "cashflow-page", period, basis, accountId }), (requestSignal) =>
      api.getCashFlow({ ...(range ?? {}), ...(basis === "per-account" && accountId ? { account_id: accountId } : {}) }, { signal: requestSignal }), { force });
    if (signal.aborted || state.status === "idle") return;
    if (state.status === "error" || !state.data) {
      grid.replaceChildren();
      setPanelBody(notePanel, errorState(state.error ?? { message: "现金流加载失败" }, () => loadCashFlow(true)));
      return;
    }
    const flow: CashFlowReport = state.data.data;
    const mismatch = reportPeriodErrors(flow, { from: range?.from, to: range?.to });
    if (mismatch.length > 0) {
      grid.replaceChildren();
      setPanelBody(notePanel, errorState({ message: `服务端现金流与请求期间不一致（${mismatch.join("、")}）；已停止展示。` }, () => loadCashFlow(true)));
      return;
    }
    grid.replaceChildren(
      valueMetricCard("经营现金流", formatSignedMoney(flow.operating_cents), state.meta?.data_state, undefined, responseCompleteness(state.meta)),
      valueMetricCard("投资现金流", formatSignedMoney(flow.investing_cents), state.meta?.data_state, undefined, responseCompleteness(state.meta)),
      valueMetricCard("筹资现金流", formatSignedMoney(flow.financing_cents), state.meta?.data_state, undefined, responseCompleteness(state.meta)),
      valueMetricCard("净现金流", formatSignedMoney(flow.net_cents), state.meta?.data_state, undefined, responseCompleteness(state.meta)),
    );
    setPanelBody(notePanel, el("div", { className: "stack" }, [
      el("p", { className: "cell-muted transaction-direction-note", textContent: "现金流符号直接来自服务端投影；正数表示净流入，负数表示净流出。" }),
      disclosure("展开现金流口径说明", el("p", { className: "cell-muted" }, [dataText(flow.note ?? "服务端未提供口径说明。")])),
      el("div", { className: "cell-muted", textContent: `期间 ${flow.from_date ?? range?.from ?? "N/A"} 至 ${flow.to_date ?? range?.to ?? "N/A"} · ${basis === "per-account" ? `单账户 ${accountSelect.selectedOptions[0]?.textContent ?? accountId}` : "合并抵消"}` }),
    ]));
  }
  await loadCashFlow();
}
