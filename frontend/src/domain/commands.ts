import type { CreateTransactionRequest, TransactionPreviewRequest } from "@wealthos/api-client";

export type CommandDraft = CreateTransactionRequest;
export type CommandCategory = { category_code: string; kind: string };
export type CommandValidationContext = { categories?: CommandCategory[] };

export interface CommandIntent {
  fingerprint: string;
  idempotencyKey: string;
}

export function createCommandIntent(draft: CommandDraft, previous?: CommandIntent): CommandIntent {
  const fingerprint = JSON.stringify(requestForSubmit(draft));
  return previous?.fingerprint === fingerprint ? previous : { fingerprint, idempotencyKey: crypto.randomUUID() };
}

export function requestForPreview(draft: CommandDraft): TransactionPreviewRequest {
  const { repayment, ...common } = draft;
  return { ...common, currency: "CNY", repayment_meta: repayment ? {
    principal_cents: repayment.principal_cents ?? 0,
    interest_cents: repayment.interest_cents ?? 0,
    fees_cents: repayment.fees_cents ?? 0,
  } : null };
}

export function requestForSubmit(draft: CommandDraft): CreateTransactionRequest {
  return { ...draft };
}

export function commandDraftErrors(draft: Partial<CommandDraft>, context: CommandValidationContext = {}): string[] {
  const errors: string[] = [];
  const type = draft.transaction_type;
  if (!type || !Number.isSafeInteger(draft.amount_cents) || (draft.amount_cents ?? 0) <= 0 || !draft.transaction_date) errors.push("required");
  if (["EXPENSE", "INCOME", "REFUND", "CREDIT_CARD_PURCHASE"].includes(type ?? "")) {
    if (!draft.category_code) errors.push("category");
  }
  const category = context.categories?.find((item) => item.category_code === draft.category_code);
  if (category) {
    if (type === "EXPENSE" || type === "CREDIT_CARD_PURCHASE" || type === "REFUND") {
      if (category.kind !== "EXPENSE") errors.push("kind");
    } else if (type === "INCOME" && category.kind !== "INCOME") errors.push("kind");
  }
  if (["EXPENSE", "TRANSFER", "REIMBURSEMENT", "LOAN_REPAYMENT", "CREDIT_CARD_REPAYMENT"].includes(type ?? "") && !draft.source_account_id) errors.push("source");
  if (type === "CREDIT_CARD_PURCHASE" && !draft.credit_account_id) errors.push("credit");
  if (["INCOME", "TRANSFER", "REFUND", "REIMBURSEMENT", "LOAN_REPAYMENT", "CREDIT_CARD_REPAYMENT"].includes(type ?? "") && !draft.destination_account_id) errors.push("destination");
  if (draft.source_account_id && draft.destination_account_id === draft.source_account_id) errors.push("distinct");
  if (type === "LOAN_REPAYMENT" || type === "CREDIT_CARD_REPAYMENT") {
    const repayment = draft.repayment;
    if (!repayment) errors.push("repayment");
    else {
      const parts = [repayment.principal_cents ?? 0, repayment.interest_cents ?? 0, repayment.fees_cents ?? 0];
      if (parts.some((value) => !Number.isSafeInteger(value) || value < 0) || parts.reduce((sum, value) => sum + value, 0) !== draft.amount_cents) errors.push("repayment");
    }
  }
  return [...new Set(errors)];
}

export function commandErrorMessage(error: unknown): string {
  const problem = (error as { problem?: { code?: string; detail?: string; title?: string }; message?: string })?.problem;
  if (problem?.code === "IDEMPOTENCY_CONFLICT" || problem?.code === "IDEMPOTENCY_IN_PROGRESS") return "同一提交意图冲突或仍在处理；不自动覆盖，请核对后重新预览。";
  if (problem?.code === "PERIOD_CLOSED") return "该记账期间已关闭；请选择开放期间，不绕过锁定。";
  if (problem?.code === "SPLIT_MISMATCH") return "还款拆分与金额不一致，请修正本金、利息和费用后重新预览。";
  return problem?.detail ?? problem?.title ?? (error as { message?: string })?.message ?? "命令未完成，请核对后重试。";
}

export function parseMoneyCents(input: string, allowZero = false): number | null {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(input.trim());
  if (!match) return null;
  const cents = Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0") || 0);
  if (!Number.isSafeInteger(cents) || cents > 100_000_000_000 || cents < 0 || (!allowZero && cents === 0)) return null;
  return cents;
}
