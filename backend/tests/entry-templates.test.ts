import { describe, it, expect } from "vitest";
import { buildEntries, splitMismatch, type TxnForTemplate } from "../src/modules/ledger/entry-templates.js";

const base: TxnForTemplate = {
  transaction_id: "t1",
  transaction_type: "EXPENSE",
  amount_cents: 10000,
  source_account_id: "a1",
  destination_account_id: null,
  category_id: "FOOD_LUNCH",
  expense_meta: { necessity_level: "ESSENTIAL" },
};

describe("entry templates (FINANCIAL-INVARIANTS §4)", () => {
  it("4.1 cash expense: PRIMARY bucketed expense + FUNDING cash leg", () => {
    const e = buildEntries(base);
    expect(e).toHaveLength(2);
    expect(e[0]).toMatchObject({
      direction: "DEBIT", amount_cents: 10000n,
      ledgerAccountKey: "cat:FOOD_LUNCH", flow_effect: "CONSUMPTION",
      entry_role: "PRIMARY", expense_bucket: "ESSENTIAL",
    });
    expect(e[1]).toMatchObject({
      direction: "CREDIT", amount_cents: 10000n,
      ledgerAccountKey: "acct:a1", flow_effect: "CONSUMPTION",
      entry_role: "FUNDING", expense_bucket: null,
    });
  });

  it("OPTIONAL/LUXURY necessity maps to DISCRETIONARY bucket", () => {
    const e = buildEntries({ ...base, expense_meta: { necessity_level: "LUXURY" } });
    expect(e[0]!.expense_bucket).toBe("DISCRETIONARY");
  });

  it("4.2 credit card purchase: PRIMARY expense + PRIMARY liability, NO funding leg", () => {
    const e = buildEntries({
      ...base,
      transaction_type: "CREDIT_CARD_PURCHASE",
      source_account_id: null,
      credit_account_id: "a7",
    });
    expect(e).toHaveLength(2);
    expect(e[0]).toMatchObject({ direction: "DEBIT", ledgerAccountKey: "cat:FOOD_LUNCH", entry_role: "PRIMARY" });
    expect(e[1]).toMatchObject({ direction: "CREDIT", ledgerAccountKey: "acct:a7", entry_role: "PRIMARY", flow_effect: "DEBT_BORROW" });
  });

  it("4.3 income: FUNDING arrival + PRIMARY income", () => {
    const e = buildEntries({
      ...base,
      transaction_type: "INCOME",
      source_account_id: "a1",
      destination_account_id: "a1", // normalized
      category_id: "SALARY_BASE",
      income_meta: { income_category: "SALARY_BASE" },
    });
    expect(e[0]).toMatchObject({ direction: "DEBIT", ledgerAccountKey: "acct:a1", entry_role: "FUNDING", flow_effect: "INCOME_SALARY" });
    expect(e[1]).toMatchObject({ direction: "CREDIT", ledgerAccountKey: "cat:SALARY_BASE", entry_role: "PRIMARY" });
  });

  it("4.4 internal transfer: two FUNDING legs, null buckets", () => {
    const e = buildEntries({
      ...base,
      transaction_type: "TRANSFER",
      source_account_id: "me-a1",
      destination_account_id: "me-a7",
    });
    expect(e).toHaveLength(2);
    expect(e.every(x => x.entry_role === "FUNDING" && x.flow_effect === "TRANSFER_INTERNAL")).toBe(true);
    expect(e[0]).toMatchObject({ direction: "DEBIT", ledgerAccountKey: "acct:me-a7" });
    expect(e[1]).toMatchObject({ direction: "CREDIT", ledgerAccountKey: "acct:me-a1" });
  });

  it("4.5 deposit open: PRIMARY asset-exchange + FUNDING transfer", () => {
    const e = buildEntries({
      ...base,
      transaction_type: "DEPOSIT_OPEN",
      source_account_id: "a1",
      destination_account_id: "a2",
    });
    expect(e[0]).toMatchObject({ direction: "DEBIT", ledgerAccountKey: "acct:a2", entry_role: "PRIMARY", flow_effect: "ASSET_EXCHANGE" });
    expect(e[1]).toMatchObject({ direction: "CREDIT", ledgerAccountKey: "acct:a1", entry_role: "FUNDING", flow_effect: "TRANSFER_INTERNAL" });
  });

  it("4.7 loan repayment 6 legs with P/I/F split (non-zero legs only)", () => {
    const e = buildEntries({
      ...base,
      transaction_type: "LOAN_REPAYMENT",
      amount_cents: 684350,
      source_account_id: "a1",
      destination_account_id: "a8",
      repayment_meta: { principal_cents: 392915, interest_cents: 291435, fees_cents: 0 },
    });
    // fees = 0 -> only 4 legs
    expect(e).toHaveLength(4);
    expect(e.filter(x => x.direction === "DEBIT").map(x => [x.ledgerAccountKey, x.flow_effect, x.expense_bucket]))
      .toEqual([
        ["acct:a8", "DEBT_PRINCIPAL_REPAY", null],
        ["cat:FINANCE_LOAN_INTEREST", "DEBT_INTEREST", "FINANCIAL_COST"],
      ]);
    const credits = e.filter(x => x.direction === "CREDIT");
    expect(credits.every(x => x.ledgerAccountKey === "acct:a1" && x.entry_role === "FUNDING")).toBe(true);
    // balance
    const d = e.filter(x => x.direction === "DEBIT").reduce((s, x) => s + x.amount_cents, 0n);
    const c = e.filter(x => x.direction === "CREDIT").reduce((s, x) => s + x.amount_cents, 0n);
    expect(d).toBe(684350n);
    expect(c).toBe(684350n);
  });

  it("4.7 rejects split mismatch with SPLIT_MISMATCH", () => {
    expect(() =>
      buildEntries({
        ...base,
        transaction_type: "LOAN_REPAYMENT",
        amount_cents: 600000,
        source_account_id: "a1",
        destination_account_id: "a8",
        repayment_meta: { principal_cents: 400000, interest_cents: 100000, fees_cents: 0 },
      }),
    ).toThrow(splitMismatch);
  });

  it("4.8 refund: FUNDING asset + PRIMARY expense REFUND_REVERSAL bucket", () => {
    const e = buildEntries({
      ...base,
      transaction_type: "REFUND",
      amount_cents: 15800,
      source_account_id: "a4",
      destination_account_id: "a4",
      category_id: "OTHER_UNCLASSIFIED",
    });
    expect(e[0]).toMatchObject({ direction: "DEBIT", ledgerAccountKey: "acct:a4", entry_role: "FUNDING", flow_effect: "REFUND_REVERSAL" });
    expect(e[1]).toMatchObject({ direction: "CREDIT", ledgerAccountKey: "cat:OTHER_UNCLASSIFIED", entry_role: "PRIMARY", expense_bucket: "REFUND_REVERSAL" });
  });

  it("4.9 reimbursement: FUNDING cash + PRIMARY receivable", () => {
    const e = buildEntries({
      ...base,
      transaction_type: "REIMBURSEMENT",
      amount_cents: 64000,
      source_account_id: "RECEIVABLE:chen",
      destination_account_id: "a1",
    });
    expect(e[0]).toMatchObject({ direction: "DEBIT", ledgerAccountKey: "acct:a1", entry_role: "FUNDING", flow_effect: "REIMBURSEMENT_RECEIPT" });
    expect(e[1]).toMatchObject({ direction: "CREDIT", ledgerAccountKey: "acct:RECEIVABLE:chen", entry_role: "PRIMARY", flow_effect: "REIMBURSEMENT_RECEIPT" });
  });

  it("dividend received: passive income template", () => {
    const e = buildEntries({
      ...base,
      transaction_type: "DIVIDEND_RECEIVED",
      amount_cents: 268000,
      source_account_id: "a5",
      destination_account_id: "a5",
      category_id: "DIVIDEND_INCOME",
    });
    expect(e[0]).toMatchObject({ direction: "DEBIT", ledgerAccountKey: "acct:a5", entry_role: "FUNDING", flow_effect: "INCOME_PASSIVE" });
    expect(e[1]).toMatchObject({ direction: "CREDIT", ledgerAccountKey: "cat:DIVIDEND_INCOME", entry_role: "PRIMARY", flow_effect: "INCOME_PASSIVE" });
  });

  it("credit card repayment (P only): 2 legs", () => {
    const e = buildEntries({
      ...base,
      transaction_type: "CREDIT_CARD_REPAYMENT",
      amount_cents: 200000,
      source_account_id: "me-a1",
      destination_account_id: "me-a6",
      repayment_meta: { principal_cents: 200000, interest_cents: 0, fees_cents: 0 },
    });
    expect(e).toHaveLength(2);
    expect(e[0]).toMatchObject({ direction: "DEBIT", ledgerAccountKey: "acct:me-a6", flow_effect: "DEBT_PRINCIPAL_REPAY", entry_role: "PRIMARY" });
    expect(e[1]).toMatchObject({ direction: "CREDIT", ledgerAccountKey: "acct:me-a1", entry_role: "FUNDING", flow_effect: "DEBT_PRINCIPAL_REPAY" });
  });
});
