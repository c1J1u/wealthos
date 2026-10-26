import type { Account } from "@wealthos/api-client";
import { api } from "../data/store";
import { getMetricBundle } from "../data/metrics";
import { normalizeQueryError } from "../data/query";
import { el } from "../components/dom";
import { openDrawer } from "../components/drawer";
import { errorState, emptyState, skeleton } from "../components/states";
import { panel, setPanelBody } from "../components/page";
import { dataStateBadgeClass, dataStateLabel, formatMoney, formatTimestamp, flowEffectLabel } from "../presentation/format";
import { pageHeading, type PageContext } from "./flows";
import { metricGrid, metricSkeletons, moneyCell, table, valueMetricCard } from "./page-primitives";
import { accountBalanceForDisplay, accountGroups } from "../domain/accounts";
import { responseCompleteness } from "../domain/response-meta";
import { dataText } from "../app/locale";

const SUBTYPE_LABELS: Record<string, string> = {
  CASH_WALLET: "现金钱包", BANK_CHECKING: "活期账户", BANK_SAVINGS: "储蓄账户", BANK_FIXED_DEPOSIT: "定期存款",
  ALIPAY_BALANCE: "支付宝余额", WECHAT_BALANCE: "微信零钱", DIGITAL_WALLET: "数字钱包", CREDIT_CARD: "信用卡",
  CONSUMER_CREDIT: "消费信贷", BROKERAGE: "证券账户", FUND_ACCOUNT: "基金账户", BOND_ACCOUNT: "债券账户",
  HOUSING_PROVIDENT_FUND: "住房公积金", PENSION_ACCOUNT: "养老金", RECEIVABLE: "应收款", PAYABLE: "应付款",
  MORTGAGE: "住房贷款", CREDIT_CARD_INSTALLMENT: "信用卡分期",
};

function openAccount(account: Account, signal: AbortSignal): void {
  void openAccountDrawer(account, signal);
}

function keyboardOpen(event: KeyboardEvent, account: Account, signal: AbortSignal): void {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    openAccount(account, signal);
  }
}

function accountCard(account: Account, signal: AbortSignal): HTMLElement {
  const card = el("button", { className: "account-card", type: "button", "aria-label": `查看${account.name}详情` }, [
    el("span", { className: "account-card__identity" }, [
    el("span", { className: "account-card__name" }, [dataText(account.name)]),
      el("span", { className: "account-card__meta" }, [`${SUBTYPE_LABELS[account.subtype] ?? account.subtype} · `, account.institution_name ? dataText(account.institution_name) : "机构未提供"]),
    ]),
    el("span", { className: "account-card__balance" }, [
      el("span", { className: "cell-money", textContent: formatMoney(accountBalanceForDisplay(account), account.currency) }),
      el("span", { className: "account-card__meta", textContent: `${account.is_restricted ? "受限" : "非受限"} · ${dataStateLabel(account.data_state)}` }),
    ]),
  ]);
  card.addEventListener("click", () => openAccount(account, signal));
  return card;
}

function groupedAccounts(accounts: Account[], signal: AbortSignal): HTMLElement {
  return el("div", { className: "account-groups" }, accountGroups(accounts).filter((group) => group.accounts.length > 0).map((group) => el("section", { className: "account-group", "aria-labelledby": `account-group-${group.id}` }, [
    el("header", { className: "account-group__header" }, [
      el("h2", { id: `account-group-${group.id}`, textContent: group.id === "ASSET" ? "资产账户" : "负债账户" }),
      el("span", { className: "cell-muted", textContent: `${group.accounts.length} 个账户 · 逐项余额` }),
    ]),
    el("div", { className: "account-group__list" }, group.accounts.map((account) => accountCard(account, signal))),
  ])));
}

export async function renderAccounts({ root, signal }: PageContext): Promise<void> {
  pageHeading(root, "账户", "资产和负债分布在哪些账户，余额是否可信");
  const grid = metricGrid(metricSkeletons(3));
  const groupsHolder = el("div");
  const listPanel = panel("账户目录", skeleton(240), true);
  root.append(grid, groupsHolder, listPanel);

  const loadMetrics = async () => {
    try {
      const res = await getMetricBundle(api, ["total_assets", "total_liabilities"], {}, { signal });
      if (signal.aborted) return;
      const metrics = new Map(res.metrics.map((metric) => [metric.metric_id, metric]));
      grid.replaceChildren(
        valueMetricCard("总资产", formatMoney(metrics.get("total_assets")?.value_cents ?? null), metrics.get("total_assets")?.data_state, "服务端口径 · 含纳入资产", responseCompleteness(res.meta, metrics.get("total_assets"))),
        valueMetricCard("总负债", formatMoney(metrics.get("total_liabilities")?.value_cents ?? null), metrics.get("total_liabilities")?.data_state, undefined, responseCompleteness(res.meta, metrics.get("total_liabilities"))),
        valueMetricCard("受限资产", "N/A", undefined, "服务端尚未提供受限资产指标"),
      );
    } catch (error) {
      if (!signal.aborted) grid.replaceChildren(errorState(normalizeQueryError(error), loadMetrics));
    }
  };

  const loadAccounts = async () => {
    setPanelBody(listPanel, skeleton(240), true);
    try {
      const res = await api.listAccounts({ limit: 200 }, { signal });
      if (signal.aborted) return;
      const accounts = res.data;
      groupsHolder.replaceChildren(accounts.length === 0 ? el("div") : groupedAccounts(accounts, signal));
      const content = table(["账户", "类型", "机构", "余额", "可用", "冻结", "净资产/受限", "流动性", "状态", "数据", "对账"], accounts.map((account) => [
        dataText(account.name),
        el("span", { className: "badge badge--neutral", textContent: SUBTYPE_LABELS[account.subtype] ?? account.subtype }),
        dataText(account.institution_name ?? "—"),
        moneyCell(formatMoney(accountBalanceForDisplay(account), account.currency)),
        moneyCell(formatMoney(account.available_balance_cents ?? null, account.currency), true),
        moneyCell(formatMoney(account.frozen_amount_cents ?? null, account.currency), true),
        `${account.include_in_net_worth ? "计入" : "不计入"} / ${account.is_restricted ? "受限" : "非受限"}`,
        account.liquidity_level ?? "—", account.status ?? "—",
        el("span", { className: dataStateBadgeClass(account.data_state), textContent: dataStateLabel(account.data_state) }),
        el("span", { className: "na", textContent: "N/A" }),
      ]));
      content.querySelectorAll<HTMLTableRowElement>("tbody tr").forEach((row, index) => {
        row.tabIndex = 0;
        row.setAttribute("aria-label", `查看${accounts[index]!.name}详情`);
        const open = () => openAccount(accounts[index]!, signal);
        row.addEventListener("click", open);
        row.addEventListener("keydown", (event: KeyboardEvent) => keyboardOpen(event, accounts[index]!, signal));
      });
      setPanelBody(listPanel, accounts.length === 0 ? emptyState("暂无账户", "当前账本没有账户记录。") : content, true);
    } catch (error) {
      if (!signal.aborted) setPanelBody(listPanel, errorState(normalizeQueryError(error), loadAccounts));
    }
  };
  await Promise.all([loadMetrics(), loadAccounts()]);
}

async function openAccountDrawer(account: Account, pageSignal: AbortSignal): Promise<void> {
  const handle = openDrawer({ title: account.name, label: "账户详情", rawTitle: true });
  const signal = AbortSignal.any([pageSignal, handle.signal]);
  handle.body.append(el("dl", { className: "kv" }, [
    el("dt", { textContent: account.normal_side === "LIABILITY" ? "欠款（展示为负）" : "余额" }), el("dd", { textContent: formatMoney(accountBalanceForDisplay(account), account.currency) }),
    el("dt", { textContent: "余额推导" }), el("dd", { textContent: "以服务端余额接口的计算方式为准" }),
    el("dt", { textContent: "可用" }), el("dd", { textContent: formatMoney(account.available_balance_cents ?? null, account.currency) }),
    el("dt", { textContent: "冻结" }), el("dd", { textContent: formatMoney(account.frozen_amount_cents ?? null, account.currency) }),
    el("dt", { textContent: "计入净资产" }), el("dd", { textContent: account.include_in_net_worth ? "是" : "否" }),
    el("dt", { textContent: "受限" }), el("dd", { textContent: account.is_restricted ? "是" : "否" }),
    el("dt", { textContent: "更新时间" }), el("dd", { textContent: account.updated_at ? formatTimestamp(account.updated_at) : "N/A · 服务端未提供" }),
    el("dt", { textContent: "最近对账" }), el("dd", { textContent: "N/A · 当前接口未提供" }),
  ]));
  const balanceHolder = el("div", {}, [skeleton(70)]);
  const entriesHolder = el("div", {}, [skeleton(140)]);
  handle.body.append(balanceHolder, entriesHolder);

  const loadBalance = async () => {
    if (signal.aborted) return;
    try {
      const res = await api.getAccountBalance(account.account_id, {}, { signal });
      if (signal.aborted) return;
      balanceHolder.replaceChildren(el("dl", { className: "kv" }, [
        el("dt", { textContent: "as-of" }), el("dd", { textContent: res.data.as_of ?? "N/A" }),
        el("dt", { textContent: "计算方式" }), el("dd", { textContent: typeof res.data.computed !== "boolean" ? "N/A · 服务端未提供" : res.data.computed ? "分录重算" : "读取缓存" }),
        el("dt", { textContent: "可用 / 冻结" }), el("dd", { textContent: res.data.available_balance_cents == null && res.data.frozen_amount_cents == null ? "N/A · 服务端未提供" : `${formatMoney(res.data.available_balance_cents ?? null, account.currency)} / ${formatMoney(res.data.frozen_amount_cents ?? null, account.currency)}` }),
      ]));
    } catch (error) {
      if (!signal.aborted && !handle.closed) balanceHolder.replaceChildren(errorState(normalizeQueryError(error), loadBalance));
    }
  };
  const loadEntries = async () => {
    if (signal.aborted) return;
    setPanelBody(entriesHolder, skeleton(140));
    try {
      const res = await api.listAccountEntries(account.account_id, { limit: 200 }, { signal });
      if (signal.aborted) return;
      setPanelBody(entriesHolder, res.data.length === 0 ? emptyState("暂无分录", "该账户没有近期分录。") : el("div", {}, [
        el("div", { className: "panel__title", textContent: `最近分录（${res.data.length}${res.meta.next_cursor ? "，仅前200条" : ""}）`, style: "margin-bottom: 0.5rem" }),
        table(["方向", "金额", "Flow"], res.data.slice(0, 20).map((entry) => [
          entry.direction === "DEBIT" ? "借" : "贷", moneyCell(formatMoney(entry.amount_cents, entry.currency ?? account.currency)), flowEffectLabel(entry.flow_effect),
        ])),
      ]));
    } catch (error) {
      if (!signal.aborted && !handle.closed) setPanelBody(entriesHolder, errorState(normalizeQueryError(error), loadEntries));
    }
  };
  await Promise.all([loadBalance(), loadEntries()]);
}
