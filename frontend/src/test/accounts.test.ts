import { describe, expect, it } from "vitest";
import { accountBalanceForDisplay, accountGroups } from "../domain/accounts";

describe("account presentation", () => {
  it("groups accounts without summing or mutating their server balances", () => {
    const asset = { account_id: "a", normal_side: "ASSET", balance_cents: 100 };
    const liability = { account_id: "b", normal_side: "LIABILITY", balance_cents: 50 };
    const groups = accountGroups([asset, liability] as never);
    expect(groups.map((group) => group.accounts.map((account) => account.account_id))).toEqual([["a"], ["b"]]);
    expect(liability.balance_cents).toBe(50);
  });

  it("shows a positive stored liability as a negative amount and preserves null and zero", () => {
    expect(accountBalanceForDisplay({ normal_side: "LIABILITY", balance_cents: 1000 })).toBe(-1000);
    expect(accountBalanceForDisplay({ normal_side: "LIABILITY", balance_cents: 0 })).toBe(0);
    expect(accountBalanceForDisplay({ normal_side: "ASSET", balance_cents: 1000 })).toBe(1000);
    expect(accountBalanceForDisplay({ normal_side: "ASSET", balance_cents: null })).toBeNull();
    expect(accountBalanceForDisplay({ normal_side: "ASSET", balance_cents: Number.MAX_SAFE_INTEGER + 1 })).toBeNull();
  });
});
