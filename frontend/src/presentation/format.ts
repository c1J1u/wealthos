// Presentation formatters. These only render server-provided values; no
// financial aggregation happens here (PRD FR-DATA-03, FR-UI-01).

export function formatMoney(cents: number | null | undefined, currency = "CNY"): string {
  if (cents === null || cents === undefined) return "N/A";
  if (!Number.isSafeInteger(cents)) return "超出可显示范围";
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const yuan = (abs / 100).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const symbol = currency === "CNY" ? "¥" : currency === "USD" ? "$" : "";
  return `${sign}${symbol}${yuan}`;
}

export function formatSignedMoney(cents: number | null | undefined, currency = "CNY"): string {
  if (cents === null || cents === undefined) return "N/A";
  return cents >= 0 ? `+${formatMoney(cents, currency)}` : formatMoney(cents, currency);
}

export function formatTransactionMoney(cents: number | null | undefined, tone: "income" | "expense" | "neutral" | "unknown", currency = "CNY"): string {
  if (cents == null) return "N/A";
  const absolute = Math.abs(cents);
  if (tone === "neutral" || tone === "unknown") return formatMoney(absolute, currency);
  return `${tone === "income" ? "+" : "−"}${formatMoney(absolute, currency)}`;
}

export function formatRatio(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "N/A";
  return `${(value * 100).toFixed(1)}%`;
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "N/A";
  return iso.slice(0, 10);
}

export function formatTimestamp(iso: string | null | undefined): string {
  if (!iso) return "N/A";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "N/A";
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(date);
}

export function formatMonths(value: number | null | undefined): string {
  if (value === null || value === undefined) return "N/A";
  return `${value.toFixed(1)} 个月`;
}

export function dataStateLabel(state: string | null | undefined): string {
  switch (state) {
    case "ACTUAL": return "实际";
    case "ESTIMATE": return "估算";
    case "BUDGET": return "预算";
    case "FORECAST": return "预测";
    case "SCENARIO": return "情景";
    default: return "未知";
  }
}

export function dataStateBadgeClass(state: string | null | undefined): string {
  if (state === "ACTUAL") return "badge badge--actual";
  if (state === "ESTIMATE") return "badge badge--estimate";
  return "badge badge--neutral";
}

export function flowEffectLabel(code: string | null | undefined): string {
  const map: Record<string, string> = {
    INCOME_SALARY: "工资收入", INCOME_OTHER: "其他收入", INCOME_PASSIVE: "被动收入",
    INCOME_REALIZED_GAIN: "已实现收益", TRANSFER_INTERNAL: "内部转账", ASSET_EXCHANGE: "资产交换",
    DEBT_BORROW: "借入", DEBT_PRINCIPAL_REPAY: "偿还本金", DEBT_INTEREST: "利息", DEBT_FEE: "费用",
    CONSUMPTION: "消费", CONSUMPTION_PF_RENT: "公积金付租", REFUND_REVERSAL: "退款冲减",
    REIMBURSEMENT_RECEIPT: "报销回款", RECEIVABLE_SETTLEMENT: "应收结算",
    PROVIDENT_FUND_EMPLOYEE: "公积金(个人)", PROVIDENT_FUND_EMPLOYER: "公积金(单位)",
    ASSET_REVALUATION: "资产重估",
  };
  return code ? (map[code] ?? code) : "N/A";
}

export function txnTypeLabel(type: string): string {
  const map: Record<string, string> = {
    INCOME: "收入", EXPENSE: "支出", TRANSFER: "转账", CREDIT_CARD_PURCHASE: "信用卡消费",
    CREDIT_CARD_REPAYMENT: "信用卡还款", LOAN_DISBURSEMENT: "贷款发放", LOAN_REPAYMENT: "贷款还款",
    DEPOSIT_OPEN: "开立定存", DEPOSIT_MATURITY: "定存到期", DEPOSIT_RENEWAL: "定存续期",
    INVESTMENT_BUY: "买入", INVESTMENT_SELL: "卖出", DIVIDEND_RECEIVED: "分红", INTEREST_RECEIVED: "利息收入",
    FEE_CHARGED: "费用", REFUND: "退款", REIMBURSEMENT: "报销", ASSET_REVALUATION: "资产重估",
    LIABILITY_ADJUSTMENT: "负债调整", CURRENCY_EXCHANGE: "换汇", OTHER_ADJUSTMENT: "其他调整",
  };
  return map[type] ?? type;
}

export function statusLabel(status: string | null | undefined): string {
  const map: Record<string, string> = { DRAFT: "草稿", PENDING: "待入账", POSTED: "已入账", RECONCILED: "已对账", VOIDED: "已作废" };
  return status ? (map[status] ?? status) : "N/A";
}

export function reconLabel(status: string | null | undefined): string {
  const map: Record<string, string> = { UNRECONCILED: "未对账", MATCHED: "已匹配", NEEDS_REVIEW: "待复核" };
  return status ? (map[status] ?? status) : "—";
}
