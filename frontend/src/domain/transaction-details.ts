import type { Transaction, TransactionEntry } from "@wealthos/api-client";
import { isDate } from "./period";

export function transactionDetailContractErrors(
  transactionId: string,
  detail: Pick<Transaction, "transaction_id" | "currency" | "related_transaction_id">,
  entries: Pick<TransactionEntry, "transaction_id" | "amount_cents" | "direction" | "currency">[],
  related: Pick<Transaction, "transaction_id" | "transaction_date" | "amount_cents"> | null,
): string[] {
  const errors = new Set<string>();
  if (detail.transaction_id !== transactionId) errors.add("详情归属");
  if (related && related.transaction_id !== detail.related_transaction_id) errors.add("关联交易归属");
  if (related && !isDate(related.transaction_date)) errors.add("关联交易日期");
  if (related && !Number.isSafeInteger(related.amount_cents)) errors.add("关联交易金额");
  const totals = { DEBIT: 0, CREDIT: 0 };
  for (const entry of entries) {
    if (entry.transaction_id !== transactionId) errors.add("分录归属");
    if (entry.currency && entry.currency !== detail.currency) errors.add("分录币种");
    if (!Number.isSafeInteger(entry.amount_cents)) errors.add("分录金额");
    if (entry.direction !== "DEBIT" && entry.direction !== "CREDIT") errors.add("分录方向");
    else {
      totals[entry.direction] += entry.amount_cents;
      if (!Number.isSafeInteger(totals[entry.direction])) errors.add("分录合计");
    }
  }
  return [...errors];
}
