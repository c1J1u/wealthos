/**
 * Fixture normalizer: implements N-01..N-12 from FINANCIAL-INVARIANTS.md §7.2.
 * Pure function: raw fixture JSON in, normalized fixture JSON out.
 * The output is what import-fixtures writes to the database.
 */
import { buildEntries, type TxnForTemplate as TemplateTxn } from "../modules/ledger/entry-templates.js";
export interface NormalizationReport {
  null_legs_fixed: number;
  same_account_transfers_fixed: number;
  synthetic_accounts: string[];
  unfixable: Array<{ transaction_id: string; reason: string }>;
}

interface Txn {
  transaction_id: string;
  transaction_type: string;
  amount_cents: number;
  source_account_id: string | null;
  destination_account_id: string | null;
  credit_account_id?: string | null;
  liability_id?: string | null;
  category_id?: string | null;
  [k: string]: unknown;
}

interface Account {
  account_id: string;
  account_name?: string;
  account_type?: string;
  account_subtype?: string;
  normal_side?: string;
  balance_cents: number;
  opening_balance_cents?: number;
  [k: string]: unknown;
}

const NULL_LEG_TYPES = new Set([
  "INCOME",
  "DIVIDEND_RECEIVED",
  "INTEREST_RECEIVED",
  "REFUND",
  "REIMBURSEMENT",
  "CREDIT_CARD_PURCHASE",
  "LOAN_REPAYMENT",
]);

export function normalizeFixture(raw: any): any {
  const out = structuredClone(raw);
  const report: NormalizationReport = {
    null_legs_fixed: 0,
    same_account_transfers_fixed: 0,
    synthetic_accounts: [],
    unfixable: [],
  };

  const liabilities = new Map<string, any>(
    (out.liabilities ?? []).map((l: any) => [l.liability_id, l]),
  );

  // ---- N-09: synthetic accounts ----
  const installment = (out.liabilities ?? []).find(
    (l: any) => l.liability_type === "CREDIT_CARD_INSTALLMENT",
  );
  if (installment) {
    // a7-installment: 845,040 per docs (840,000 principal + 5,040 fees)
    out.accounts.push({
      account_id: "a7-installment",
      account_name: "信用卡分期（合成）",
      account_type: "CREDIT",
      account_subtype: "CREDIT_CARD_INSTALLMENT",
      normal_side: "LIABILITY",
      balance_cents: installment.outstanding_principal_cents + (installment.fees_payable_cents ?? 0),
      synthetic: true,
    });
    report.synthetic_accounts.push("a7-installment");
  }
  out.accounts.push({
    account_id: "RECEIVABLE:chen",
    account_name: "应收报销款（合成）",
    account_type: "OTHER",
    account_subtype: "RECEIVABLE",
    normal_side: "ASSET",
    balance_cents: 0,
    synthetic: true,
  });
  report.synthetic_accounts.push("RECEIVABLE:chen");

  // ---- N-01..N-07: per-transaction leg repair ----
  for (const t of out.transactions as Txn[]) {
    const tt = t.transaction_type;
    const src = t.source_account_id;
    const dst = t.destination_account_id;

    // N-07: DEPOSIT_OPEN with source == destination -> funding from real checking
    if (tt === "DEPOSIT_OPEN" && src !== null && src === dst) {
      const funding = (out.accounts as Account[]).find(
        (a) => a.account_id !== dst && a.account_subtype === "BANK_CHECKING",
      );
      if (funding) {
        t.source_account_id = funding.account_id;
        report.same_account_transfers_fixed++;
      } else {
        report.unfixable.push({
          transaction_id: t.transaction_id,
          reason: "N-07: no distinct checking account for deposit funding",
        });
      }
      continue;
    }

    if (!NULL_LEG_TYPES.has(tt) || dst !== null) continue;

    switch (tt) {
      case "INCOME":
      case "DIVIDEND_RECEIVED":
      case "INTEREST_RECEIVED":
        // N-01/02: destination = source (arrival account)
        t.destination_account_id = src;
        t.source_account_id = null;
        report.null_legs_fixed++;
        break;
      case "REFUND":
        // N-03: destination = source; category remapped
        t.destination_account_id = src;
        t.source_account_id = null;
        t.category_id = "OTHER_UNCLASSIFIED";
        report.null_legs_fixed++;
        break;
      case "REIMBURSEMENT":
        // N-04: money arrives at source; receivable decreases
        t.destination_account_id = src;
        t.source_account_id = "RECEIVABLE:chen";
        report.null_legs_fixed++;
        break;
      case "CREDIT_CARD_PURCHASE":
        // N-05: destination = card liability account
        t.destination_account_id = t.credit_account_id ?? null;
        if (t.destination_account_id === null) {
          report.unfixable.push({
            transaction_id: t.transaction_id,
            reason: "N-05: credit_account_id missing",
          });
        } else {
          report.null_legs_fixed++;
        }
        break;
      case "LOAN_REPAYMENT": {
        // N-06: destination = liability's account
        const liab = t.liability_id ? liabilities.get(t.liability_id) : null;
        const dest = liab?.account_id ?? null;
        if (dest === null) {
          report.unfixable.push({
            transaction_id: t.transaction_id,
            reason: "N-06: liability has no account_id",
          });
        } else {
          t.destination_account_id = dest;
          report.null_legs_fixed++;
        }
        break;
      }
    }
  }

  // ---- N-08: recompute openings from the ENTRY TEMPLATES ----
  // Same source of truth as the importer: buildEntries produces the exact
  // vector written to transaction_entries, so opening + entries = current
  // holds by construction. balance_cents (raw current) is NEVER modified.
  const accounts = new Map<string, Account>(
    (out.accounts as Account[]).map((a) => [a.account_id, a]),
  );
  const openingDelta = new Map<string, bigint>();
  for (const t of out.transactions as Txn[]) {
    const specs = buildEntries(t as TemplateTxn);
    for (const s of specs) {
      if (!s.ledgerAccountKey.startsWith("acct:")) continue;
      const acctId = s.ledgerAccountKey.slice(5);
      const acct = accounts.get(acctId);
      if (!acct) {
        throw new Error(`N-08: entry references unknown account ${acctId} (${t.transaction_id})`);
      }
      const normalDebit = acct.normal_side !== "LIABILITY"; // ASSET -> debit-normal
      const sign = (s.direction === "DEBIT" ? 1n : -1n) * (normalDebit ? 1n : -1n);
      openingDelta.set(acctId, (openingDelta.get(acctId) ?? 0n) + sign * s.amount_cents);
    }
  }
  for (const a of accounts.values()) {
    const rawBalance = raw.accounts.find((r: any) => r.account_id === a.account_id)?.balance_cents;
    const base = typeof rawBalance === "number" ? rawBalance : a.balance_cents;
    (a as any).opening_balance_cents = Number(BigInt(base) - (openingDelta.get(a.account_id) ?? 0n));
    (a as any).opening_data_state = "ESTIMATE";
  }

  out._normalization_report = report;
  return out;
}
