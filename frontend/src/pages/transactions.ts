import type { Account, Category, Transaction } from "@wealthos/api-client";
import { api } from "../data/store";
import { el, clear, icon } from "../components/dom";
import { errorState, skeleton, emptyState } from "../components/states";
import { filterFailure, popCursor, unsupportedTransactionFilters } from "../domain/transactions";
import { dataTable } from "../components/table";
import { openDrawer as openDrawerShell } from "../components/drawer";
import { formatMoney, formatDate, txnTypeLabel, flowEffectLabel, dataStateBadgeClass, dataStateLabel, statusLabel, reconLabel } from "../presentation/format";
import { transactionAmountLabel } from "../components/transaction-amount";
import { validDateRange } from "../domain/period";
import { normalizeQueryError } from "../data/query";
import { transactionDetailContractErrors } from "../domain/transaction-details";
import { routeWithParams } from "../app/route-state";
import { COMMANDS_ENABLED } from "../app/mode";
import { openTransactionCommand } from "../components/transaction-command";
import { commandErrorMessage } from "../domain/commands";
import { transactionSummaryView } from "../components/view-read-models";
import { dataText } from "../app/locale";

export interface TxnFilter {
  from?: string; to?: string; type?: string; q?: string; cursor?: string;
  account_id?: string; category_code?: string; status?: string; reconciliation?: string;
  data_state?: string;
}

export async function renderTransactions(root: HTMLElement, params: URLSearchParams, signal: AbortSignal): Promise<void> {
  clear(root);
  const filter: TxnFilter = {
    from: params.get("from") ?? undefined,
    to: params.get("to") ?? undefined,
    type: params.get("type") ?? undefined,
    q: params.get("q") ?? undefined,
    cursor: params.get("cursor") ?? undefined,
    account_id: params.get("account_id") ?? undefined,
    category_code: params.get("category_code") ?? undefined,
    status: params.get("status") ?? undefined,
    reconciliation: params.get("reconciliation") ?? undefined,
    data_state: params.get("data_state") ?? undefined,
  };
  const cursorHistory = params.getAll("history").filter((cursor) => cursor !== filter.cursor);
  const currentCursor = filter.cursor ?? "";

  root.append(el("div", { className: "page-header rise" }, [
    el("div", {}, [
      el("h1", { textContent: "流水" }),
      el("div", { className: "page-header__sub", textContent: "每一笔钱的来龙去脉" }),
    ]),
    COMMANDS_ENABLED ? el("button", { className: "button button--primary", textContent: "记一笔", "aria-label": "记一笔", "data-command": "create-transaction" }) : "",
  ]));
  const createButton = root.querySelector<HTMLButtonElement>('button[data-command="create-transaction"]');
  if (createButton) createButton.addEventListener("click", async () => {
    createButton.disabled = true;
    try {
      const [{ acctRes, catRes }, metaResponse] = await Promise.all([loadLookups(), api.getMeta({ signal }).catch(() => null)]);
      if (signal.aborted) return;
      if (!acctRes || !catRes) {
        lookupNotice.hidden = false;
        lookupNotice.className = "partial-state";
        lookupNotice.textContent = "账户或分类目录不可用，暂未打开记账表单；请先重试加载。";
        return;
      }
      const accounts: Account[] = acctRes.data.map((account) => ({ ...account }));
      const categories: Category[] = catRes.data.map((category) => ({ ...category }));
      const today = metaResponse?.data.today ?? new Date().toISOString().slice(0, 10);
      openTransactionCommand(accounts, categories, today, async () => { await load(); });
    } finally {
      if (!signal.aborted) createButton.disabled = false;
    }
  });

  const filterBar = el("div", { className: "filter-bar rise rise-1", style: "margin-bottom: 1rem" });
  const fromInput = el("input", { type: "date", lang: "zh-CN", value: filter.from ?? "", "aria-label": "开始日期" });
  const toInput = el("input", { type: "date", lang: "zh-CN", value: filter.to ?? "", "aria-label": "结束日期" });
  const typeSelect = el("select", { "aria-label": "类型" }, [
    el("option", { value: "", textContent: "全部类型" }),
    ...["INCOME", "EXPENSE", "TRANSFER", "CREDIT_CARD_PURCHASE", "CREDIT_CARD_REPAYMENT", "LOAN_DISBURSEMENT", "LOAN_REPAYMENT", "DEPOSIT_OPEN", "DEPOSIT_MATURITY", "DEPOSIT_RENEWAL", "INVESTMENT_BUY", "INVESTMENT_SELL", "DIVIDEND_RECEIVED", "INTEREST_RECEIVED", "FEE_CHARGED", "REFUND", "REIMBURSEMENT", "ASSET_REVALUATION", "LIABILITY_ADJUSTMENT", "CURRENCY_EXCHANGE", "OTHER_ADJUSTMENT"].map((t) =>
      el("option", { value: t, textContent: txnTypeLabel(t), ...(filter.type === t ? { selected: true } : {}) })),
  ]);
  const accountSelect = el("select", { "aria-label": "账户" }, [el("option", { value: "", textContent: "全部账户" })]);
  const categorySelect = el("select", { "aria-label": "分类" }, [el("option", { value: "", textContent: "全部分类" })]);
  const statusSelect = el("select", { "aria-label": "状态" }, [
    el("option", { value: "", textContent: "全部状态" }),
    ...[["POSTED","已入账"],["PENDING","待入账"],["RECONCILED","已对账"],["VOIDED","已作废"],["DRAFT","草稿"]].map(([v,l]) =>
      el("option", { value: v, textContent: l, ...(filter.status === v ? { selected: true } : {}) })),
  ]);
  const reconSelect = el("select", { "aria-label": "对账" }, [
    el("option", { value: "", textContent: "对账状态" }),
    ...[["MATCHED","已匹配"],["UNRECONCILED","未对账"],["NEEDS_REVIEW","待复核"]].map(([v,l]) =>
      el("option", { value: v, textContent: l, ...(filter.reconciliation === v ? { selected: true } : {}) })),
  ]);
  const searchInput = el("input", { type: "search", placeholder: "搜索商户或备注", value: filter.q ?? "", "aria-label": "搜索" });
  const dataStateSelect = el("select", { "aria-label": "数据状态" }, [
    el("option", { value: "", textContent: "全部数据态" }),
    ...[["ACTUAL", "实际"], ["ESTIMATE", "估算"]].map(([value, label]) =>
      el("option", { value, textContent: label, ...(filter.data_state === value ? { selected: true } : {}) })),
  ]);
  const applyBtn = el("button", { className: "button", textContent: "应用" });
  const basicFilters = el("div", { className: "filter-bar__basic" }, [fromInput, toInput, typeSelect]);
  const advancedFilters = el("details", { className: "advanced-filters", ...(filter.account_id || filter.category_code || filter.status || filter.reconciliation || filter.data_state ? { open: true } : {}) }, [
    el("summary", {}, [icon("filter", 15), el("span", { textContent: "更多筛选" })]),
    el("div", { className: "advanced-filters__body filter-bar" }, [accountSelect, categorySelect, statusSelect, reconSelect, dataStateSelect]),
  ]);
  const searchFilters = el("div", { className: "filter-bar__search" }, [searchInput, applyBtn]);
  filterBar.append(basicFilters, advancedFilters, searchFilters);

  const tablePanel = el("section", { className: "panel rise rise-2", "data-panel": "transactions" }, [
    el("div", { className: "panel__body panel__body--flush", "aria-busy": "true" }, [skeleton(300)]),
  ]);
  const pagination = el("div", { style: "margin-top: 1rem; display: flex; gap: 0.5rem; justify-content: flex-end" });
  const summaryPanel = el("section", { className: "panel rise rise-1", "data-panel": "transaction-summary" }, [
    el("header", { className: "panel__header" }, [el("div", { className: "panel__title", textContent: "筛选范围汇总" })]),
    el("div", { className: "panel__body", "aria-busy": "true" }, [skeleton(70)]),
  ]);
  const lookupNotice = el("div");
  lookupNotice.hidden = true;
  root.append(lookupNotice);
  root.append(filterBar, summaryPanel, tablePanel, pagination);
  let accountsCache: Awaited<ReturnType<typeof api.listAccounts>> | null | undefined;
  let categoriesCache: Awaited<ReturnType<typeof api.listCategories>> | null | undefined;
  const loadLookups = async () => {
    accountsCache ??= await api.listAccounts({ limit: 200 }, { signal }).catch(() => null);
    categoriesCache ??= await api.listCategories({}, { signal }).catch(() => null);
    return { acctRes: accountsCache, catRes: categoriesCache };
  };

  const apply = () => {
    if (!validDateRange(fromInput.value || undefined, toInput.value || undefined)) {
      toInput.setCustomValidity("请使用有效日期，并确保开始日期不晚于结束日期");
      toInput.reportValidity();
      return;
    }
    toInput.setCustomValidity("");
    const p = new URLSearchParams(location.hash.split("?")[1] ?? "");
    const values = { from: fromInput.value, to: toInput.value, type: typeSelect.value, q: searchInput.value, account_id: accountSelect.value, category_code: categorySelect.value, status: statusSelect.value, reconciliation: reconSelect.value, data_state: dataStateSelect.value };
    for (const [key, value] of Object.entries(values)) {
      if (value) p.set(key, value); else p.delete(key);
    }
    location.hash = `#/transactions?${p.toString()}`;
    location.hash = routeWithParams(location.hash, {}, ["cursor", "history"]);
  };
  applyBtn.addEventListener("click", apply);
  searchInput.addEventListener("keydown", (e) => { if (e.key === "Enter") apply(); });

  const load = async () => {
    const body = tablePanel.querySelector(".panel__body") as HTMLElement;
    clear(body);
    body.setAttribute("aria-busy", "true");
    body.append(skeleton(300));
    accountSelect.replaceChildren(el("option", { value: "", textContent: "全部账户" }));
    categorySelect.replaceChildren(el("option", { value: "", textContent: "全部分类" }));
    try {
    void loadSummary();
    const { acctRes, catRes } = await loadLookups();
    if (acctRes) {
      for (const a of acctRes.data) {
        accountSelect.append(el("option", { value: a.account_id, ...(filter.account_id === a.account_id ? { selected: true } : {}) }, [dataText(a.name)]));
      }
    }
    if (catRes) {
      for (const c of catRes.data) {
        categorySelect.append(el("option", { value: c.category_code, ...(filter.category_code === c.category_code ? { selected: true } : {}) }, [dataText(c.name_zh)]));
      }
    }
    if (!validDateRange(filter.from, filter.to)) {
      clear(body);
      body.append(errorState({ message: "URL 中的日期范围无效；请重新选择开始和结束日期。" }));
      return;
    }
    const res = await api.listTransactions({ ...filter, limit: 25 }, { signal });
    if (signal.aborted) return;
    if (!acctRes) {
      lookupNotice.hidden = false;
      lookupNotice.className = "partial-state";
      lookupNotice.textContent = "账户目录暂不可用；保留账户 ID，无法显示完整账户名。流水按服务端返回展示。";
    } else {
      lookupNotice.hidden = true;
      lookupNotice.textContent = "";
    }
    const catName = new Map((catRes?.data ?? []).map((c) => [c.category_code, c.name_zh]));
    const accountName = new Map((acctRes?.data ?? []).map((a) => [a.account_id, a.name]));
    clear(body);
    const items = res.data;
    const ignored = unsupportedTransactionFilters(filter, items);
    if (ignored.length > 0) {
      body.append(errorState(filterFailure(ignored)));
      return;
    }
    if (items.length === 0) {
      body.append(emptyState("没有符合条件的交易", "调整筛选条件，或等待后端接入更多期间。"));
      return;
    }
    const table = dataTable(["日期", "商户/备注", "类型", "分类", "账户", "金额", "Flow", "状态/对账", "数据"], items.map((t) => [
          el("td", { className: "cell-muted", textContent: formatDate(t.transaction_date) }),
          el("td", {}, [dataText(t.merchant_name ?? t.description ?? "—")]),
          el("td", {}, [el("span", { className: "badge badge--neutral", textContent: txnTypeLabel(t.transaction_type) })]),
          el("td", { className: "cell-muted" }, [dataText(t.category_code ? (catName.get(t.category_code) ?? t.category_code) : "N/A")]),
          el("td", { className: "cell-muted" }, [dataText(accountNames(t, accountName))]),
          el("td", {}, [transactionAmountLabel(t)]),
          el("td", { className: "cell-muted", textContent: flowEffectLabel(t.entries[0]?.flow_effect) }),
          el("td", { className: "cell-muted", textContent: `${statusLabel(t.status)} / ${reconLabel(t.reconciliation_status)}` }),
          el("td", {}, [el("span", { className: dataStateBadgeClass(t.data_state), textContent: dataStateLabel(t.data_state) })]),
        ]));
    table.classList.add("table-region--transaction-list");
    const hint = table.querySelector(".table-scroll-hint");
    if (hint) hint.textContent = "点选流水查看分类、账户、Flow 与对账详情";
    table.querySelectorAll("tbody tr").forEach((tr, index) => {
      const t = items[index]!;
      tr.setAttribute("tabindex", "0");
      tr.setAttribute("role", "button");
      tr.setAttribute("aria-label", `查看${t.merchant_name ?? t.description ?? "交易"}详情`);
      tr.addEventListener("click", () => { void openDrawer(t, catName, accountName, signal); });
      tr.addEventListener("keydown", (event) => {
        if ((event as KeyboardEvent).key === "Enter" || (event as KeyboardEvent).key === " ") {
          event.preventDefault();
          void openDrawer(t, catName, accountName, signal);
        }
      });
    });
    body.append(table);

    clear(pagination);
    if (cursorHistory.length > 0) {
      const previous = el("button", { className: "button", textContent: "上一页" });
      previous.addEventListener("click", () => {
        const p = new URLSearchParams(location.hash.split("?")[1] ?? "");
        const prior = popCursor(cursorHistory);
        p.delete("history");
        for (const cursor of prior.history) p.append("history", cursor);
        if (prior.cursor) p.set("cursor", prior.cursor); else p.delete("cursor");
        location.hash = `#/transactions?${p.toString()}`;
      });
      pagination.append(previous);
    }
    if (res.meta.next_cursor) {
      const next = el("button", { className: "button", textContent: "下一页" });
      next.addEventListener("click", () => {
        const p = new URLSearchParams(location.hash.split("?")[1] ?? "");
        p.append("history", currentCursor);
        p.set("cursor", res.meta.next_cursor!);
        location.hash = `#/transactions?${p.toString()}`;
      });
      pagination.append(next);
    }
    } catch (err) {
      if (signal.aborted) return;
      clear(body);
      body.append(errorState(normalizeQueryError(err), load));
    } finally {
      body.setAttribute("aria-busy", "false");
    }
  };
  const loadSummary = async () => {
    const body = summaryPanel.querySelector(".panel__body") as HTMLElement;
    body.setAttribute("aria-busy", "true");
    body.replaceChildren(skeleton(70));
    try {
      const { cursor: _cursor, ...scope } = filter;
      const response = await api.getView("transactions", scope, { signal });
      if (signal.aborted) return;
      body.setAttribute("aria-busy", "false");
      body.replaceChildren(transactionSummaryView(response.data.summary));
    } catch (error) {
      if (signal.aborted) return;
      body.setAttribute("aria-busy", "false");
      body.replaceChildren(errorState(normalizeQueryError(error), loadSummary));
    }
  };
  await load();
}

function accountNames(t: Transaction, accounts: Map<string, string>): string {
  const ids = new Set([
    t.source_account_id, t.destination_account_id, t.credit_account_id,
    ...t.entries.map((entry) => entry.account_id),
  ].filter((id): id is string => typeof id === "string"));
  const names = [...ids].map((id) => accounts.get(id) ?? "账户名未提供");
  return names.length > 0 ? names.join(" → ") : "N/A";
}

async function openDrawer(t: Transaction, categories: Map<string, string>, accounts: Map<string, string>, pageSignal: AbortSignal): Promise<void> {
  const handle = openDrawerShell({ title: t.merchant_name ?? t.description ?? "交易详情", label: "交易详情", rawTitle: Boolean(t.merchant_name || t.description) });
  const signal = AbortSignal.any([pageSignal, handle.signal]);

  const kv = el("dl", { className: "kv" }, [
    el("dt", { textContent: "日期" }), el("dd", { textContent: formatDate(t.transaction_date) }),
    el("dt", { textContent: "类型" }), el("dd", { textContent: txnTypeLabel(t.transaction_type) }),
    el("dt", { textContent: "金额" }), el("dd", {}, [transactionAmountLabel(t)]),
    el("dt", { textContent: "分类" }), el("dd", {}, [dataText(t.category_code ? (categories.get(t.category_code) ?? t.category_code) : "N/A")]),
    el("dt", { textContent: "付款账户" }), el("dd", {}, [dataText(t.source_account_id ? (accounts.get(t.source_account_id) ?? "未命名账户") : "N/A")]),
    el("dt", { textContent: "收款账户" }), el("dd", {}, [dataText(t.destination_account_id ? (accounts.get(t.destination_account_id) ?? "未命名账户") : "N/A")]),
    el("dt", { textContent: "信用账户" }), el("dd", {}, [dataText(t.credit_account_id ? (accounts.get(t.credit_account_id) ?? "未命名账户") : "N/A")]),
    el("dt", { textContent: "关联交易" }), el("dd", { textContent: t.related_transaction_id ?? "无" }),
    el("dt", { textContent: "状态" }), el("dd", { textContent: statusLabel(t.status) }),
    el("dt", { textContent: "对账" }), el("dd", { textContent: reconLabel(t.reconciliation_status) }),
  ]);

  const entriesHolder = el("div", {}, [skeleton(120)]);
  handle.body.append(kv, entriesHolder);
  let voidButton: HTMLButtonElement | null = null;
  if (COMMANDS_ENABLED) {
    const button = el("button", { className: "button command-danger", textContent: "冲销此交易", disabled: t.status === "VOIDED" || Boolean(t.voided_by_transaction_id) });
    voidButton = button;
    handle.body.append(el("div", { className: "command-actions" }, [button]));
    button.addEventListener("click", async () => {
      if (button.dataset.confirmed !== "true") {
        button.dataset.confirmed = "true";
        button.textContent = "确认冲销？将生成反向交易";
        handle.body.append(el("p", { className: "command-warning", textContent: "冲销不会修改原历史分录；服务端创建反向交易后，原交易显示为已冲销。再次点击确认。" }));
        return;
      }
      button.disabled = true;
      try {
        const result = await api.voidTransaction(t.transaction_id, { reason: "前端确认冲销" }, crypto.randomUUID(), { signal });
        handle.body.append(el("p", { className: "command-success", textContent: `已创建反向交易 ${result.data.transaction_id}；请重新读取流水。` }));
      } catch (error) {
        button.disabled = false;
        handle.body.append(errorState({ message: commandErrorMessage(error) }));
      }
    });
  }

  const related = t.related_transaction_id ? el("div", { className: "panel" }, [
    el("div", { className: "panel__body", textContent: "正在加载关联交易…" }),
  ]) : null;
  if (related) handle.body.append(related);
  const load = async () => {
    if (signal.aborted || handle.closed) return;
    entriesHolder.replaceChildren(skeleton(120));
    try {
      const [detail, entries, relatedTransaction] = await Promise.all([
        api.getTransaction(t.transaction_id, { signal }),
        api.listTransactionEntries(t.transaction_id, { signal }),
        t.related_transaction_id ? api.getTransaction(t.related_transaction_id, { signal }) : Promise.resolve(null),
      ]);
      if (signal.aborted || handle.closed) return;
      const finalTransaction = detail.data;
      if (voidButton) voidButton.disabled = finalTransaction.status === "VOIDED" || Boolean(finalTransaction.voided_by_transaction_id);
      const finalEntries = entries.data;
      const contractErrors = transactionDetailContractErrors(t.transaction_id, finalTransaction, finalEntries, relatedTransaction?.data ?? null);
      if (contractErrors.length > 0) throw Object.assign(new Error(`交易详情响应不一致（${contractErrors.join("、")}）；已停止展示。`), { problem: { code: "INVALID_RESPONSE", request_id: detail.meta.request_id } });
      const debit = finalEntries.filter((entry) => entry.direction === "DEBIT").reduce((sum, entry) => sum + entry.amount_cents, 0);
      const credit = finalEntries.filter((entry) => entry.direction === "CREDIT").reduce((sum, entry) => sum + entry.amount_cents, 0);
      const entryTable = dataTable(["#", "方向", "科目", "金额", "Flow"], finalEntries.map((entry) => [
        String(entry.line_no), entry.direction === "DEBIT" ? "借" : "贷", entry.ledger_account_code,
        el("span", { className: "cell-money", textContent: formatMoney(entry.amount_cents, entry.currency ?? finalTransaction.currency) }),
        flowEffectLabel(entry.flow_effect),
      ]));
      entriesHolder.replaceChildren(
        el("div", { className: "panel__title", textContent: `分录（借贷${debit === credit ? "平衡" : "不平衡"}）`, style: "margin-bottom: 0.5rem" }), entryTable,
      );
      if (related && relatedTransaction) {
        related.replaceChildren(el("div", { className: "panel__body" }, [
          el("div", { className: "panel__title", textContent: "关联交易" }),
          el("p", { className: "cell-muted", textContent: `${formatDate(relatedTransaction.data.transaction_date)} · ${relatedTransaction.data.merchant_name ?? relatedTransaction.data.description ?? "交易"} · ${formatMoney(relatedTransaction.data.amount_cents, relatedTransaction.data.currency)}` }),
        ]));
      }
    } catch (error) {
      if (signal.aborted || handle.closed) return;
      entriesHolder.replaceChildren(errorState(normalizeQueryError(error), load));
    }
  };
  await load();
}
