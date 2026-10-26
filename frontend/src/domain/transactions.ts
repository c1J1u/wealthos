import type { Transaction } from "@wealthos/api-client";

export interface TransactionFilter {
  from?: string;
  to?: string;
  type?: string;
  q?: string;
  status?: string;
  reconciliation?: string;
  category_code?: string;
  data_state?: string;
  account_id?: string;
}

export function isTransactionInAccount(transaction: Transaction, accountId: string): boolean {
  return transaction.source_account_id === accountId || transaction.destination_account_id === accountId
    || transaction.credit_account_id === accountId || transaction.entries.some((entry) => entry.account_id === accountId);
}

// Validate what the server returned, never repair it with a client-side filter.
// An empty result cannot prove that a filter is supported, so it is not flagged.
export function unsupportedTransactionFilters(filter: TransactionFilter, items: Transaction[]): string[] {
  if (items.length === 0) return [];
  const ignored: string[] = [];
  if (filter.type && items.some((t) => t.transaction_type !== filter.type)) ignored.push("type");
  if (filter.status && items.some((t) => t.status !== filter.status)) ignored.push("status");
  if (filter.reconciliation && items.some((t) => t.reconciliation_status !== filter.reconciliation)) ignored.push("reconciliation");
  if (filter.category_code && items.some((t) => t.category_code !== filter.category_code)) ignored.push("category_code");
  if (filter.data_state && items.some((t) => t.data_state !== filter.data_state)) ignored.push("data_state");
  if (filter.account_id && items.some((t) => !isTransactionInAccount(t, filter.account_id!))) ignored.push("account_id");
  if (filter.from && items.some((t) => t.transaction_date < filter.from!)) ignored.push("from");
  if (filter.to && items.some((t) => t.transaction_date > filter.to!)) ignored.push("to");
  if (filter.q) {
    const q = filter.q.toLocaleLowerCase();
    const allMatch = items.every((t) => `${t.merchant_name ?? ""} ${t.description ?? ""}`.toLocaleLowerCase().includes(q));
    if (!allMatch) ignored.push("q");
  }
  return [...new Set(ignored)];
}

export function filterFailure(ignored: string[]): { message: string } {
  return {
    message: `当前服务未按 ${ignored.join("、")} 正确筛选；为避免展示错误流水，本列表已停止渲染。请使用未筛选视图，或等待后端补齐筛选语义。`,
  };
}

export function settlementFilterErrors(
  refunds: Transaction[],
  reimbursements: Transaction[],
  range: { from?: string; to?: string } = {},
): string[] {
  return [...new Set([
    ...unsupportedTransactionFilters({ type: "REFUND", ...range }, refunds),
    ...unsupportedTransactionFilters({ type: "REIMBURSEMENT", ...range }, reimbursements),
  ])];
}

export function popCursor(history: string[]): { cursor?: string; history: string[] } {
  if (history.length === 0) return { cursor: undefined, history: [] };
  const previous = history.at(-2);
  return { cursor: previous || undefined, history: history.slice(0, -2) };
}
