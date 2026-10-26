import { describe, expect, it } from "vitest";
import { valuationContractErrors } from "../domain/assets";
import { transactionDetailContractErrors } from "../domain/transaction-details";

describe("entity response boundaries", () => {
  it("rejects valuations belonging to another asset or unsafe amounts", () => {
    expect(valuationContractErrors("asset-a", [{ asset_id: "asset-b", as_of: "2026-01-01", market_value_cents: 100 }])).toContain("资产归属");
    expect(valuationContractErrors("asset-a", [{ asset_id: "asset-a", as_of: "2026-02-30", market_value_cents: Number.MAX_SAFE_INTEGER + 1 }])).toEqual(expect.arrayContaining(["估值日期", "估值金额"]));
    expect(valuationContractErrors("asset-a", [{ asset_id: "asset-a", as_of: "2026-02-28", market_value_cents: 100 }])).toEqual([]);
  });

  it("rejects mismatched detail, entries, related transactions and unsafe totals", () => {
    const entry = { transaction_id: "txn-a", amount_cents: 100, direction: "DEBIT" as const, currency: "CNY" };
    expect(transactionDetailContractErrors("txn-a", { transaction_id: "txn-b", currency: "CNY" }, [], null)).toContain("详情归属");
    expect(transactionDetailContractErrors("txn-a", { transaction_id: "txn-a", currency: "CNY" }, [{ ...entry, transaction_id: "txn-b" }], null)).toContain("分录归属");
    expect(transactionDetailContractErrors("txn-a", { transaction_id: "txn-a", currency: "CNY" }, [{ ...entry, currency: "USD" }], null)).toContain("分录币种");
    expect(transactionDetailContractErrors("txn-a", { transaction_id: "txn-a", currency: "CNY" }, [], { transaction_id: "txn-b", transaction_date: "2026-01-01", amount_cents: 100 })).toContain("关联交易归属");
    expect(transactionDetailContractErrors("txn-a", { transaction_id: "txn-a", currency: "CNY" }, [entry, entry, entry], null)).toEqual([]);
    expect(transactionDetailContractErrors("txn-a", { transaction_id: "txn-a", currency: "CNY", related_transaction_id: "txn-b" }, [], { transaction_id: "txn-b", transaction_date: "2026-02-30", amount_cents: Number.MAX_SAFE_INTEGER + 1 })).toEqual(expect.arrayContaining(["关联交易日期", "关联交易金额"]));
  });
});
