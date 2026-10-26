import type { ViewPayload } from "@wealthos/api-client";

export function compositionErrors(composition: ViewPayload["composition"]): string[] {
  if (!Array.isArray(composition)) return ["未提供"];
  if (composition.some((row) => typeof row.label !== "string" || !Number.isSafeInteger(row.amount_cents)
    || (row.share != null && (!Number.isFinite(row.share) || row.share < 0 || row.share > 1)))) return ["金额/占比"];
  return [];
}

export function stabilityRows(stability: NonNullable<ViewPayload["income_stability"]>): [string, string | number | null][] {
  return [
    ["经常性收入", stability.recurring_income_cents ?? null], ["一次性收入", stability.one_off_income_cents ?? null],
    ["来源数", stability.source_count ?? null], ["最大来源", stability.top_source_label ?? null],
    ["最大来源金额", stability.top_source_amount_cents ?? null], ["最大来源占比", stability.top_source_share ?? null],
  ];
}

export function regularityRows(regularity: NonNullable<ViewPayload["expense_regularity"]>): [string, string | number | null][] {
  return [
    ["固定支出", regularity.fixed_expense_cents ?? null], ["变动支出", regularity.variable_expense_cents ?? null],
    ["可报销支出", regularity.reimbursable_expense_cents ?? null], ["已收到报销", regularity.reimbursement_received_cents ?? null],
  ];
}

export function transactionSummaryRows(summary: NonNullable<ViewPayload["summary"]>): [string, string | number | null][] {
  return [["流水笔数", summary.count ?? null], ["流入", summary.inflow_cents ?? null], ["流出", summary.outflow_cents ?? null]];
}

export function viewPeriodErrors(requested: string, returned: string | undefined): string[] {
  return returned === requested ? [] : ["期间"];
}
