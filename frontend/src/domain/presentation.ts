import type { Transaction } from "@wealthos/api-client";

export type TransactionAmountTone = "income" | "expense" | "neutral" | "unknown";

export function transactionAmountTone(transaction: Transaction): TransactionAmountTone {
  if (transaction.display_effect === "INFLOW") return "income";
  if (transaction.display_effect === "OUTFLOW") return "expense";
  if (transaction.display_effect === "NEUTRAL") return "neutral";
  const entries = transaction.entries;
  if (!entries?.length || entries.some((entry) => !entry.flow_effect)) return "unknown";
  const effects = new Set(entries.map((entry) => entry.flow_effect!));
  const incoming = (effect: string) => effect.startsWith("INCOME_") || ["REFUND_REVERSAL", "REIMBURSEMENT_RECEIPT", "RECEIVABLE_SETTLEMENT"].includes(effect);
  const outgoing = (effect: string) => ["CONSUMPTION", "CONSUMPTION_PF_RENT", "DEBT_INTEREST", "DEBT_FEE", "DEBT_PRINCIPAL_REPAY"].includes(effect);
  const neutral = (effect: string) => ["TRANSFER_INTERNAL", "ASSET_EXCHANGE"].includes(effect);
  if ([...effects].every(incoming)) return "income";
  if ([...effects].every(outgoing)) return "expense";
  if ([...effects].every(neutral)) return "neutral";
  // Mixed or unknown effects require a server-provided display_effect.
  return "unknown";
}
