import type { Transaction } from "@wealthos/api-client";
import { transactionAmountTone } from "../domain/presentation";
import { formatTransactionMoney } from "../presentation/format";
import { el } from "./dom";

export function transactionAmountLabel(transaction: Transaction): HTMLElement {
  const tone = transactionAmountTone(transaction);
  const amount = formatTransactionMoney(transaction.amount_cents, tone, transaction.currency);
  const labels = { income: "流入", expense: "流出", neutral: "中性转移", unknown: "方向待服务端提供" };
  return el("span", {
    className: `cell-money cell-money--${tone}`,
    textContent: amount,
    "data-flow-label": tone === "expense" ? "流出" : tone === "income" ? "流入" : tone === "neutral" ? "中性" : "方向待提供",
    "aria-label": tone === "unknown" ? `金额 ${formatTransactionMoney(transaction.amount_cents, "neutral", transaction.currency)}，方向待服务端提供` : `${labels[tone]} ${amount}`,
    title: tone === "unknown" ? "列表缺少可识别的 flow_effect；不按交易类型猜测方向" : labels[tone],
  });
}
