/**
 * Standard entry templates — FINANCIAL-INVARIANTS.md §4.
 * Pure functions: a normalized transaction becomes a vector of entry specs.
 * The importer resolves ledgerAccountKey to concrete ledger_account UUIDs:
 *   acct:<account_id>   -> account-backed ASSET/LIABILITY ledger account
 *   cat:<category_code> -> category-backed INCOME/EXPENSE ledger account
 *
 * Amounts are BIGINT-safe: all arithmetic uses BigInt internally, exposed as
 * bigint. Zero-amount legs are omitted (schema CHECK amount_cents > 0).
 */

export type Direction = "DEBIT" | "CREDIT";
export type EntryRole = "PRIMARY" | "FUNDING" | "MEMO";
export type ExpenseBucket = "ESSENTIAL" | "DISCRETIONARY" | "FINANCIAL_COST" | "REFUND_REVERSAL" | null;

export interface EntrySpec {
  line_no: number;
  direction: Direction;
  amount_cents: bigint;
  ledgerAccountKey: string;
  flow_effect: string;
  entry_role: EntryRole;
  expense_bucket: ExpenseBucket;
}

export interface TxnForTemplate {
  transaction_id: string;
  transaction_type: string;
  amount_cents: number;
  source_account_id: string | null;
  destination_account_id: string | null;
  credit_account_id?: string | null;
  category_id?: string | null;
  income_meta?: { income_category?: string | null } | null;
  expense_meta?: { necessity_level?: string | null } | null;
  repayment_meta?: { principal_cents: number; interest_cents: number; fees_cents: number } | null;
}

/** Marker class for P+I+F != amount. */
export class SplitMismatchError extends Error {
  constructor(txnId: string, sum: bigint, amount: bigint) {
    super(`SPLIT_MISMATCH on ${txnId}: principal+interest+fees=${sum} != amount=${amount}`);
    this.name = "SplitMismatchError";
  }
}
export const splitMismatch = SplitMismatchError;

/** Interest legs post to this synthetic expense category (FINANCIAL_COST). */
export const DEBT_INTEREST_CATEGORY = "FINANCE_LOAN_INTEREST";
export const DEBT_FEE_CATEGORY = "FINANCE_INSTALLMENT_FEE";

function necessityToBucket(n: string | null | undefined): Exclude<ExpenseBucket, "FINANCIAL_COST" | "REFUND_REVERSAL"> {
  return n === "ESSENTIAL" ? "ESSENTIAL" : "DISCRETIONARY";
}

function incomeEffect(category: string | null | undefined, type: string): string {
  if (type === "DIVIDEND_RECEIVED" || type === "INTEREST_RECEIVED") return "INCOME_PASSIVE";
  if (category?.startsWith("SALARY")) return "INCOME_SALARY";
  return "INCOME_OTHER";
}

interface Leg {
  direction: Direction;
  amount: bigint;
  key: string;
  effect: string;
  role: EntryRole;
  bucket?: ExpenseBucket;
}

function finalize(txnId: string, legs: Leg[]): EntrySpec[] {
  const out: EntrySpec[] = [];
  let line = 1;
  for (const l of legs) {
    if (l.amount <= 0n) continue; // zero legs omitted (amount CHECK > 0)
    out.push({
      line_no: line++,
      direction: l.direction,
      amount_cents: l.amount,
      ledgerAccountKey: l.key,
      flow_effect: l.effect,
      entry_role: l.role,
      expense_bucket: l.bucket ?? null,
    });
  }
  const debit = out.reduce((s, e) => s + (e.direction === "DEBIT" ? e.amount_cents : 0n), 0n);
  const credit = out.reduce((s, e) => s + (e.direction === "CREDIT" ? e.amount_cents : 0n), 0n);
  if (out.length < 2 || debit !== credit) {
    throw new Error(
      `template for ${txnId} produced unbalanced vector: debit=${debit} credit=${credit} legs=${out.length}`,
    );
  }
  return out;
}

function repaymentLegs(t: TxnForTemplate): Leg[] {
  const m = t.repayment_meta;
  if (!m) throw new Error(`repayment_meta missing on ${t.transaction_id}`);
  const P = BigInt(m.principal_cents);
  const I = BigInt(m.interest_cents);
  const F = BigInt(m.fees_cents);
  const amount = BigInt(t.amount_cents);
  if (P + I + F !== amount) throw new SplitMismatchError(t.transaction_id, P + I + F, amount);
  const src = t.source_account_id;
  const dst = t.destination_account_id;
  if (!src || !dst) throw new Error(`repayment ${t.transaction_id} missing source/destination`);
  const legs: Leg[] = [
    // PRIMARY side
    { direction: "DEBIT", amount: P, key: `acct:${dst}`, effect: "DEBT_PRINCIPAL_REPAY", role: "PRIMARY" },
    { direction: "DEBIT", amount: I, key: `cat:${DEBT_INTEREST_CATEGORY}`, effect: "DEBT_INTEREST", role: "PRIMARY", bucket: "FINANCIAL_COST" },
    { direction: "DEBIT", amount: F, key: `cat:${DEBT_FEE_CATEGORY}`, effect: "DEBT_FEE", role: "PRIMARY", bucket: "FINANCIAL_COST" },
    // FUNDING side
    { direction: "CREDIT", amount: P, key: `acct:${src}`, effect: "DEBT_PRINCIPAL_REPAY", role: "FUNDING" },
    { direction: "CREDIT", amount: I, key: `acct:${src}`, effect: "DEBT_INTEREST", role: "FUNDING" },
    { direction: "CREDIT", amount: F, key: `acct:${src}`, effect: "DEBT_FEE", role: "FUNDING" },
  ];
  return legs;
}

export function buildEntries(t: TxnForTemplate): EntrySpec[] {
  const amount = BigInt(t.amount_cents);
  const src = t.source_account_id;
  const dst = t.destination_account_id;
  const cat = t.category_id ?? null;

  switch (t.transaction_type) {
    case "EXPENSE": {
      if (!src || !cat) throw new Error(`EXPENSE ${t.transaction_id} needs source + category`);
      return finalize(t.transaction_id, [
        { direction: "DEBIT", amount, key: `cat:${cat}`, effect: "CONSUMPTION", role: "PRIMARY", bucket: necessityToBucket(t.expense_meta?.necessity_level) },
        { direction: "CREDIT", amount, key: `acct:${src}`, effect: "CONSUMPTION", role: "FUNDING" },
      ]);
    }
    case "CREDIT_CARD_PURCHASE": {
      const card = t.credit_account_id;
      if (!card || !cat) throw new Error(`CREDIT_CARD_PURCHASE ${t.transaction_id} needs credit_account + category`);
      return finalize(t.transaction_id, [
        { direction: "DEBIT", amount, key: `cat:${cat}`, effect: "CONSUMPTION", role: "PRIMARY", bucket: necessityToBucket(t.expense_meta?.necessity_level) },
        { direction: "CREDIT", amount, key: `acct:${card}`, effect: "DEBT_BORROW", role: "PRIMARY" },
      ]);
    }
    case "INCOME":
    case "DIVIDEND_RECEIVED":
    case "INTEREST_RECEIVED": {
      if (!dst || !cat) throw new Error(`${t.transaction_type} ${t.transaction_id} needs destination + category`);
      const effect = incomeEffect(t.income_meta?.income_category ?? cat, t.transaction_type);
      return finalize(t.transaction_id, [
        { direction: "DEBIT", amount, key: `acct:${dst}`, effect, role: "FUNDING" },
        { direction: "CREDIT", amount, key: `cat:${cat}`, effect, role: "PRIMARY" },
      ]);
    }
    case "TRANSFER": {
      if (!src || !dst) throw new Error(`TRANSFER ${t.transaction_id} needs source + destination`);
      return finalize(t.transaction_id, [
        { direction: "DEBIT", amount, key: `acct:${dst}`, effect: "TRANSFER_INTERNAL", role: "FUNDING" },
        { direction: "CREDIT", amount, key: `acct:${src}`, effect: "TRANSFER_INTERNAL", role: "FUNDING" },
      ]);
    }
    case "DEPOSIT_OPEN": {
      if (!src || !dst) throw new Error(`DEPOSIT_OPEN ${t.transaction_id} needs source + destination`);
      return finalize(t.transaction_id, [
        { direction: "DEBIT", amount, key: `acct:${dst}`, effect: "ASSET_EXCHANGE", role: "PRIMARY" },
        { direction: "CREDIT", amount, key: `acct:${src}`, effect: "TRANSFER_INTERNAL", role: "FUNDING" },
      ]);
    }
    case "LOAN_REPAYMENT":
    case "CREDIT_CARD_REPAYMENT":
      return finalize(t.transaction_id, repaymentLegs(t));
    case "REFUND": {
      if (!dst || !cat) throw new Error(`REFUND ${t.transaction_id} needs destination + category`);
      return finalize(t.transaction_id, [
        { direction: "DEBIT", amount, key: `acct:${dst}`, effect: "REFUND_REVERSAL", role: "FUNDING" },
        { direction: "CREDIT", amount, key: `cat:${cat}`, effect: "REFUND_REVERSAL", role: "PRIMARY", bucket: "REFUND_REVERSAL" },
      ]);
    }
    case "REIMBURSEMENT": {
      if (!src || !dst) throw new Error(`REIMBURSEMENT ${t.transaction_id} needs source + destination`);
      return finalize(t.transaction_id, [
        { direction: "DEBIT", amount, key: `acct:${dst}`, effect: "REIMBURSEMENT_RECEIPT", role: "FUNDING" },
        { direction: "CREDIT", amount, key: `acct:${src}`, effect: "REIMBURSEMENT_RECEIPT", role: "PRIMARY" },
      ]);
    }
    default:
      throw new Error(`no entry template for transaction_type=${t.transaction_type}`);
  }
}
