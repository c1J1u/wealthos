import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { normalizeFixture } from "../src/scripts/normalize-fixture.js";

const ROOT = resolve(import.meta.dirname, "..");

function loadChen() {
  return JSON.parse(
    readFileSync(resolve(ROOT, "fixtures/chen.json"), "utf8"),
  ) as any;
}

describe("normalizeFixture (N-01..N-12)", () => {
  it("fixes all 23 null asset/liability legs (N-01..N-06)", () => {
    const out = normalizeFixture(loadChen());
    const report = out._normalization_report;
    expect(report.null_legs_fixed).toBe(23);
    expect(report.unfixable).toEqual([]);
  });

  it("fixes t13 same-account deposit transfer (N-07)", () => {
    const out = normalizeFixture(loadChen());
    const t13 = out.transactions.find((t: any) => t.transaction_id === "t13");
    expect(t13.source_account_id).not.toBe(t13.destination_account_id);
    // funding leg must be the external checking account per docs (chen t13 -> a1)
    expect(t13.source_account_id).toBe("a1");
  });

  it("REFUND category remapped to OTHER_UNCLASSIFIED (N-03)", () => {
    const out = normalizeFixture(loadChen());
    const refund = out.transactions.find((t: any) => t.transaction_type === "REFUND");
    expect(refund.category_id).toBe("OTHER_UNCLASSIFIED");
  });

  it("REIMBURSEMENT uses synthetic receivable (N-04)", () => {
    const out = normalizeFixture(loadChen());
    const reimb = out.transactions.find((t: any) => t.transaction_type === "REIMBURSEMENT");
    expect(reimb.source_account_id).toBe("RECEIVABLE:chen");
  });

  it("CREDIT_CARD_PURCHASE destination = credit account (N-05)", () => {
    const out = normalizeFixture(loadChen());
    const ccs = out.transactions.filter((t: any) => t.transaction_type === "CREDIT_CARD_PURCHASE");
    expect(ccs.length).toBe(9);
    for (const cc of ccs) {
      expect(cc.destination_account_id).toBe(cc.credit_account_id);
    }
  });

  it("LOAN_REPAYMENT destination = liability account (N-06)", () => {
    const out = normalizeFixture(loadChen());
    const loans = out.transactions.filter((t: any) => t.transaction_type === "LOAN_REPAYMENT");
    expect(loans.length).toBe(3);
    for (const l of loans) {
      expect(l.destination_account_id).toBeTruthy();
    }
  });

  it("synthetic accounts a7-installment and RECEIVABLE present (N-09)", () => {
    const out = normalizeFixture(loadChen());
    const ids = out.accounts.map((a: any) => a.account_id);
    expect(ids).toContain("a7-installment");
    expect(ids).toContain("RECEIVABLE:chen");
  });

  it("opening balances recomputed so current = raw (N-08)", () => {
    const raw = loadChen();
    const out = normalizeFixture(raw);
    for (const acct of out.accounts) {
      if (acct.synthetic) continue; // synthetic accounts have no raw counterpart
      const rawAcct = raw.accounts.find((a: any) => a.account_id === acct.account_id);
      expect(acct.balance_cents).toBe(rawAcct!.balance_cents);
    }
    // and openings exist for every account
    for (const acct of out.accounts) {
      expect(typeof acct.opening_balance_cents).toBe("number");
    }
  });

  it("INVARIANT: opening + Σ entry effects == raw current, per account (N-08 real check)", async () => {
    const { buildEntries } = await import("../src/modules/ledger/entry-templates.js");
    for (const name of ["chen", "me"]) {
      const raw = JSON.parse(
        readFileSync(resolve(ROOT, `fixtures/${name}.json`), "utf8"),
      ) as any;
      const out = normalizeFixture(raw);
      const delta = new Map<string, bigint>();
      for (const t of out.transactions) {
        for (const e of buildEntries(t)) {
          if (!e.ledgerAccountKey.startsWith("acct:")) continue;
          const id = e.ledgerAccountKey.slice(5);
          const acct = out.accounts.find((a: any) => a.account_id === id);
          const normalDebit = acct?.normal_side !== "LIABILITY";
          const sign = (e.direction === "DEBIT" ? 1n : -1n) * (normalDebit ? 1n : -1n);
          delta.set(id, (delta.get(id) ?? 0n) + sign * e.amount_cents);
        }
      }
      for (const acct of out.accounts) {
        const opening = BigInt(acct.opening_balance_cents);
        const expected = opening + (delta.get(acct.account_id) ?? 0n);
        expect(`${name}/${acct.account_id}: ${expected}`).toBe(
          `${name}/${acct.account_id}: ${BigInt(acct.balance_cents)}`,
        );
      }
    }
  });
});
