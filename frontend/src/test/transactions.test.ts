import { describe, expect, it } from "vitest";
import type { Transaction } from "@wealthos/api-client";
import { isTransactionInAccount, popCursor, settlementFilterErrors, unsupportedTransactionFilters } from "../domain/transactions";

function transaction(overrides: Partial<Transaction>): Transaction {
  return {
    transaction_id: "t1",
    transaction_type: "EXPENSE",
    amount_cents: 100,
    currency: "CNY",
    transaction_date: "2025-06-14",
    posting_date: "2025-06-14",
    status: "POSTED",
    data_state: "ACTUAL",
    version: 1,
    entries: [],
    ...overrides,
  } as Transaction;
}

describe("unsupportedTransactionFilters", () => {
  it("detects server results that contradict type/date/status filters", () => {
    const items = [transaction({ transaction_type: "EXPENSE" })];
    expect(unsupportedTransactionFilters({ type: "INCOME", from: "2025-07-01", status: "VOIDED" }, items))
      .toEqual(["type", "status", "from"]);
  });

  it("accepts matching results and does not guess from empty results", () => {
    expect(unsupportedTransactionFilters({ type: "EXPENSE" }, [transaction({})])).toEqual([]);
    expect(unsupportedTransactionFilters({ type: "INCOME" }, [])).toEqual([]);
  });

  it("deduplicates reasons when a row violates multiple filters", () => {
    const items = [transaction({ transaction_type: "EXPENSE" })];
    expect(unsupportedTransactionFilters({ type: "INCOME", from: "2025-07-01" }, items)).toEqual(["type", "from"]);
  });

  it("detects a search that returned unrelated rows", () => {
    const items = [transaction({ merchant_name: "盒马鲜生", description: "采购" })];
    expect(unsupportedTransactionFilters({ q: "京东" }, items)).toEqual(["q"]);
    expect(unsupportedTransactionFilters({ q: "盒马" }, items)).toEqual([]);
    expect(unsupportedTransactionFilters({ q: "盒马" }, [...items, transaction({ merchant_name: "京东" })])).toEqual(["q"]);
  });

  it("checks account and data-state filters without changing returned rows", () => {
    const accountId = "account-1";
    const item = transaction({ source_account_id: accountId, data_state: "ACTUAL" });
    expect(isTransactionInAccount(item, accountId)).toBe(true);
    expect(isTransactionInAccount(item, "other-account")).toBe(false);
    expect(unsupportedTransactionFilters({ account_id: "other-account" }, [item])).toEqual(["account_id"]);
    expect(unsupportedTransactionFilters({ data_state: "ESTIMATE" }, [item])).toEqual(["data_state"]);
  });
});

describe("settlement response validation", () => {
  it("validates each response with its own requested type", () => {
    const refund = transaction({ transaction_type: "REFUND" });
    const reimbursement = transaction({ transaction_type: "REIMBURSEMENT" });
    expect(settlementFilterErrors([refund], [reimbursement])).toEqual([]);
    expect(settlementFilterErrors([refund], [transaction({ transaction_type: "EXPENSE" })])).toEqual(["type"]);
  });
});

describe("cursor history", () => {
  it("returns to the immediately preceding cursor", () => {
    expect(popCursor(["c1", "c2"])).toEqual({ cursor: "c1", history: [] });
    expect(popCursor(["c1"])).toEqual({ cursor: undefined, history: [] });
    expect(popCursor([])).toEqual({ cursor: undefined, history: [] });
  });

  it("keeps an empty first-page sentinel until returning home", () => {
    const second = popCursor(["", "c1", "c2"]);
    expect(second).toEqual({ cursor: "c1", history: [""] });
    expect(popCursor(second.history)).toEqual({ cursor: undefined, history: [] });
  });
});
