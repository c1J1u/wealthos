import type { Account } from "@wealthos/api-client";

export type AccountGroup = "ASSET" | "LIABILITY";

export function accountGroups(accounts: Account[]): { id: AccountGroup; accounts: Account[] }[] {
  return (["ASSET", "LIABILITY"] as const).map((id) => ({ id, accounts: accounts.filter((account) => account.normal_side === id) }));
}

export function accountBalanceForDisplay(account: { balance_cents: number | null | undefined; normal_side: Account["normal_side"] }): number | null {
  if (account.balance_cents == null || !Number.isSafeInteger(account.balance_cents)) return null;
  return account.normal_side === "LIABILITY" && account.balance_cents !== 0 ? -account.balance_cents : account.balance_cents;
}
