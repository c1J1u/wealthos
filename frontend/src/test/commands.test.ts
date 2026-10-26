import { describe, expect, it } from "vitest";
import { commandDraftErrors, commandErrorMessage, createCommandIntent, requestForPreview, requestForSubmit, parseMoneyCents, type CommandDraft } from "../domain/commands";

const draft: CommandDraft = {
  transaction_type: "LOAN_REPAYMENT", amount_cents: 684350, transaction_date: "2025-07-10",
  source_account_id: "source", destination_account_id: "loan", repayment: { principal_cents: 392915, interest_cents: 291435, fees_cents: 0 },
};

describe("transaction command intent", () => {
  it("parses money without binary floating-point rounding and permits zero repayment legs", () => {
    expect(parseMoneyCents("6843.50")).toBe(684350);
    expect(parseMoneyCents("0", true)).toBe(0);
    expect(parseMoneyCents("0")).toBeNull();
    expect(parseMoneyCents("1.234", true)).toBeNull();
  });
  it("maps repayment_meta for preview and repayment for create", () => {
    expect(requestForPreview(draft).repayment_meta).toEqual(draft.repayment);
    expect(requestForPreview(draft)).not.toHaveProperty("repayment");
    expect(requestForSubmit(draft).repayment).toEqual(draft.repayment);
    expect(requestForSubmit(draft)).not.toHaveProperty("repayment_meta");
  });

  it("reuses one idempotency key only for the unchanged intent", () => {
    const intent = createCommandIntent(draft);
    expect(intent.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
    expect(intent.idempotencyKey).toBe(createCommandIntent(draft, intent).idempotencyKey);
    expect(createCommandIntent({ ...draft, amount_cents: 1 }, intent).idempotencyKey).not.toBe(intent.idempotencyKey);
  });

  it("preserves specific conflict, period, split and replay errors", () => {
    expect(commandErrorMessage({ problem: { code: "IDEMPOTENCY_CONFLICT" } })).toContain("不自动覆盖");
    expect(commandErrorMessage({ problem: { code: "PERIOD_CLOSED" } })).toContain("已关闭");
    expect(commandErrorMessage({ problem: { code: "SPLIT_MISMATCH" } })).toContain("拆分");
  });

  it("validates account roles and categories before preview", () => {
    expect(commandDraftErrors({ transaction_type: "EXPENSE", amount_cents: 100, transaction_date: "2025-07-01", source_account_id: "cash" })).toContain("category");
    expect(commandDraftErrors({ transaction_type: "INCOME", amount_cents: 100, transaction_date: "2025-07-01", destination_account_id: "cash" })).toContain("category");
    expect(commandDraftErrors({ transaction_type: "REFUND", amount_cents: 100, transaction_date: "2025-07-01", destination_account_id: "cash" })).toContain("category");
    expect(commandDraftErrors({ transaction_type: "CREDIT_CARD_PURCHASE", amount_cents: 100, transaction_date: "2025-07-01", source_account_id: "cash", category_code: "FOOD_LUNCH" })).toContain("credit");
    expect(commandDraftErrors({ transaction_type: "CREDIT_CARD_PURCHASE", amount_cents: 100, transaction_date: "2025-07-01", credit_account_id: "card", category_code: "FOOD_LUNCH" })).toEqual([]);
    expect(commandDraftErrors({ transaction_type: "TRANSFER", amount_cents: 100, transaction_date: "2025-07-01", source_account_id: "cash", destination_account_id: "cash" })).toContain("distinct");
    expect(commandDraftErrors({ transaction_type: "EXPENSE", amount_cents: 100, transaction_date: "2025-07-01", source_account_id: "cash", category_code: "SALARY_BASE" }, { categories: [{ category_code: "SALARY_BASE", kind: "INCOME" }] })).toContain("kind");
  });
});
