#!/usr/bin/env tsx
/**
 * Import normalized fixtures into a demo database.
 *
 *   npx tsx src/scripts/import-fixtures.ts chen
 *   npx tsx src/scripts/import-fixtures.ts me
 *
 * Safe to re-run: wipes and re-creates the persona's book first
 * (demo databases only — never point this at your real ledger).
 *
 * Pipeline (PHASE-1-IMPLEMENTATION-PLAN §4.1):
 *   raw fixture -> normalize (N-01..N-12) -> users/books/accounts/COA
 *   -> per-account opening transactions -> posted transactions+entries
 *   -> holdings -> instruments/positions/market_prices
 *   -> verify: computed balance == raw current, unbalanced == 0
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Pool } from "pg";
import { loadConfig } from "../config/config.js";
import { normalizeFixture } from "./normalize-fixture.js";
import { buildEntries } from "../modules/ledger/entry-templates.js";
import { fixtureId } from "./fixture-ids.js";
import { setForceRls } from "../database/local-fixtures.js";

const ROOT = resolve(import.meta.dirname, "../..");

async function main() {
  const persona = process.argv[2];
  if (persona !== "chen" && persona !== "me") {
    console.error("usage: import-fixtures.ts chen|me");
    process.exit(2);
  }

  if (process.env.DB_LOCAL_NAME !== "wealthos_demo" && process.env.WEALTHOS_DEMO_IMPORT_CONFIRM !== "wealthos_demo") {
    throw new Error("Fixture import is restricted to an explicitly selected wealthos_demo database.");
  }

  const raw = JSON.parse(readFileSync(resolve(ROOT, `fixtures/${persona}.json`), "utf8"));
  const data = normalizeFixture(raw);

  const cfg = loadConfig(undefined, ROOT);
  const user = cfg.database.migrationUser ?? cfg.database.user;
  const password = cfg.database.migrationPassword ?? cfg.database.password;
  const pool = new Pool({
    host: cfg.database.host, port: cfg.database.port, database: cfg.database.name,
    user, password, max: 1,
  });

  const client = await pool.connect();
  try {
    await setForceRls(client, false);
    try {
      await importPersona(client, persona, data);
    } finally {
      await setForceRls(client, true);
    }
  } finally {
    client.release();
    await pool.end();
  }
}

// ---------------------------------------------------------------------------
// book-scoped helpers: every write runs with SET LOCAL app.book_id
// ---------------------------------------------------------------------------

type Ctx = { client: import("pg").PoolClient; bookId: string };

async function bookQuery(ctx: Ctx, sql: string, params: unknown[] = []) {
  await ctx.client.query("SELECT set_config('app.book_id', $1, true)", [ctx.bookId]);
  return ctx.client.query(sql, params);
}

// ---------------------------------------------------------------------------
// import
// ---------------------------------------------------------------------------

export async function importPersona(client: import("pg").PoolClient, persona: string, data: any) {
  const userId = fixtureId(persona, "user", persona);
  const bookId = fixtureId(persona, "book", persona);
  const ctx: Ctx = { client, bookId };

  await client.query("BEGIN");
  try {
    // users row persists across books (no book_id, no RLS)
    await client.query(
      `INSERT INTO users (user_id, email, display_name)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id) DO UPDATE SET display_name = EXCLUDED.display_name`,
      [userId, `${persona}@demo.wealthos.local`, data.profile.display_name],
    );

    // -- book + membership --
    await bookQuery(ctx,
      `INSERT INTO ledger_books (book_id, owner_user_id, name) VALUES ($1, $2, $3)`,
      [bookId, userId, `Demo · ${data.profile.display_name}`]);
    await bookQuery(ctx,
      `INSERT INTO memberships (book_id, user_id, role) VALUES ($1, $2, 'OWNER')`,
      [bookId, userId]);

    // -- accounts --
    for (const a of data.accounts) {
      await bookQuery(ctx,
        `INSERT INTO accounts (account_id, book_id, name, type, subtype,
             institution_name, normal_side, include_in_net_worth, liquidity_level,
             opened_at, data_state)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'ESTIMATE')`,
        [
          fixtureId(persona, "account", a.account_id), bookId,
          a.account_name, mapAccountType(a.account_type), a.account_subtype,
          a.institution_name ?? null, a.normal_side,
          a.include_in_net_worth ?? true,
          liquidityFor(a.account_subtype), a.opened_at ?? null,
        ]);
    }

    // -- COA: account-backed ledger accounts --
    for (const a of data.accounts) {
      const code = coaCodeFor(a);
      await bookQuery(ctx,
        `INSERT INTO ledger_accounts (ledger_account_id, book_id, code, name, class, normal_side, account_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [fixtureId(persona, "ledger_account", a.account_id), bookId, code,
         a.account_name, classFor(a), normalSideFor(a),
         fixtureId(persona, "account", a.account_id)]);
    }

    // -- COA: category-backed ledger accounts (all fixture categories) --
    let incomeSeq = 4000, expenseSeq = 5000;
    for (const c of data.categories) {
      const code = c.kind === "INCOME" ? String(++incomeSeq) : String(++expenseSeq);
      await bookQuery(ctx,
        `INSERT INTO ledger_accounts (ledger_account_id, book_id, code, name, class, normal_side, category_code)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [fixtureId(persona, "ledger_account", `cat:${c.category_id}`), bookId, code,
         c.name_zh ?? c.category_id, c.kind, c.kind === "INCOME" ? "CREDIT" : "DEBIT", c.category_id]);
    }

    // -- COA: EQUITY:OPENING system account --
    await bookQuery(ctx,
      `INSERT INTO ledger_accounts (ledger_account_id, book_id, code, name, class, normal_side, is_system)
       VALUES ($1,$2,'3001','Opening Balance','EQUITY','CREDIT',true)`,
      [fixtureId(persona, "ledger_account", "EQUITY:OPENING"), bookId]);

    // -- opening transactions (one per account, per opening_balances unique) --
    const asOf = earliestTxnDate(data);
    for (const a of data.accounts) {
      const opening = a.opening_balance_cents as number;
      if (opening === 0) continue;
      const txnId = fixtureId(persona, "opening_txn", a.account_id);
      const acctLa = fixtureId(persona, "ledger_account", a.account_id);
      const eqLa = fixtureId(persona, "ledger_account", "EQUITY:OPENING");
      const amount = BigInt(Math.abs(opening));
      const isAsset = a.normal_side === "ASSET";
      // positive opening on ASSET: DEBIT asset / CREDIT equity
      // negative opening on ASSET: DEBIT equity / CREDIT asset
      // positive opening on LIABILITY: CREDIT liability / DEBIT equity
      // negative opening on LIABILITY: CREDIT equity / DEBIT liability
      const assetLegDebit = isAsset ? opening > 0 : opening < 0;
      await bookQuery(ctx,
        `INSERT INTO transactions (transaction_id, book_id, transaction_type, amount_cents,
             transaction_date, posting_date, status, data_state, source_type, description)
         VALUES ($1,$2,'OTHER_ADJUSTMENT',$3,$4,$4,'POSTED','ESTIMATE','FILE_IMPORT',$5)`,
        [txnId, bookId, amount.toString(), asOf, `Opening balance for ${a.account_id}`]);
      await bookQuery(ctx,
        `INSERT INTO transaction_entries (entry_id, transaction_id, line_no, direction, amount_cents,
             ledger_account_id, flow_effect, entry_role)
         VALUES ($1,$2,1,$3,$4,$5,'OTHER_ADJUSTMENT',$6),
                ($7,$2,2,$8,$4,$9,'OTHER_ADJUSTMENT','MEMO')`,
        [
          fixtureId(persona, "opening_entry", `${a.account_id}:1`), txnId,
          assetLegDebit ? "DEBIT" : "CREDIT", amount.toString(),
          acctLa, "PRIMARY",
          fixtureId(persona, "opening_entry", `${a.account_id}:2`),
          assetLegDebit ? "CREDIT" : "DEBIT", eqLa,
        ]);
      await bookQuery(ctx,
        `INSERT INTO opening_balances (opening_balance_id, book_id, account_id, as_of, amount_cents, data_state, transaction_id, source)
         VALUES ($1,$2,$3,$4,$5,'ESTIMATE',$6,'fixture-normalization')`,
        [fixtureId(persona, "opening_balance", a.account_id), bookId,
         fixtureId(persona, "account", a.account_id), asOf,
         BigInt(opening).toString(), txnId]);
    }

    // -- transactions + entries --
    let entryCount = 0;
    for (const t of data.transactions) {
      const txnId = fixtureId(persona, "txn", t.transaction_id);
      const specs = buildEntries(t as any);
      await bookQuery(ctx,
        `INSERT INTO transactions (transaction_id, book_id, transaction_type, amount_cents,
             transaction_date, posting_date, status, reconciliation_status, source_account_id,
             destination_account_id, credit_account_id, category_code, merchant_name, description,
             data_state, source_type, is_recurring, frequency_type, reimbursable)
         VALUES ($1,$2,$3,$4,$5,$5,'POSTED',$6,$7,$8,$9,$10,$11,$12,$13,'FILE_IMPORT',$14,$15,$16)`,
        [
          txnId, bookId, t.transaction_type, BigInt(t.amount_cents).toString(),
          t.transaction_date, t.reconciliation_status ?? "UNRECONCILED",
          accountUuid(persona, t.source_account_id),
          accountUuid(persona, t.destination_account_id),
          accountUuid(persona, t.credit_account_id),
          categoryCode(t), t.merchant_name ?? null,
          t.description ?? `${t.transaction_type} ${t.transaction_id}`,
          t.data_state ?? "ACTUAL",
          Boolean(t.is_recurring),
          (t as any).frequency_type ?? (t as any).income_meta?.income_frequency ?? null,
          Boolean((t as any).expense_meta?.reimbursable),
        ]);
      for (const s of specs) {
        await bookQuery(ctx,
          `INSERT INTO transaction_entries (entry_id, transaction_id, line_no, direction,
               amount_cents, ledger_account_id, flow_effect, entry_role, expense_bucket)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [
            fixtureId(persona, "entry", `${t.transaction_id}:${s.line_no}`), txnId,
            s.line_no, s.direction, s.amount_cents.toString(),
            resolveLedgerAccount(persona, s.ledgerAccountKey),
            s.flow_effect, s.entry_role, s.expense_bucket,
          ]);
        entryCount++;
      }
    }

    // -- holdings -> instruments / market_prices / positions (N-10) --
    for (const h of data.holdings ?? []) {
      const instId = fixtureId(persona, "instrument", h.symbol);
      const asOf = latestTxnDate(data);
      await bookQuery(ctx,
        `INSERT INTO instruments (instrument_id, book_id, ticker, name, asset_class)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (instrument_id) DO UPDATE SET name = EXCLUDED.name`,
        [instId, bookId, h.symbol, h.name, assetClassFor(h.type)]);
      await bookQuery(ctx,
        `INSERT INTO market_prices (instrument_id, as_of, source, price_cents)
         VALUES ($1,$2,'FIXTURE',$3)`,
        [instId, asOf, BigInt(h.price).toString()]);
      const brokerage = data.accounts.find((a: any) => a.account_subtype === "BROKERAGE");
      if (!brokerage) continue; // positions need an account; skip if book has none
      await bookQuery(ctx,
        `INSERT INTO positions (position_id, book_id, instrument_id, account_id, quantity, average_cost_cents, total_cost_basis_cents)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [fixtureId(persona, "position", h.symbol), bookId, instId,
         fixtureId(persona, "account", brokerage.account_id),
         h.qty.toString(), BigInt(h.cost).toString(),
         (BigInt(h.qty) * BigInt(h.cost)).toString()]);
    }

    // -- verification inside the same transaction: a failed check rolls back everything --
    await verify(ctx, data, entryCount);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  }
}

// ---------------------------------------------------------------------------
// verification: the hard checks from PHASE-1-IMPLEMENTATION-PLAN §4.3
// ---------------------------------------------------------------------------

async function verify(ctx: Ctx, data: any, entryCount: number) {
  const { client, bookId } = ctx;
  // runs inside the caller's transaction; app.book_id already set by bookQuery
  // but SET LOCAL may have been reset — re-assert it.
  await client.query("SELECT set_config('app.book_id', $1, true)", [bookId]);

  // 1. per-account: opening + entry effects == raw current balance
  const bal = await client.query<{ account_id: string; raw_id: string; computed: string; expected: string }>(`
    SELECT a.account_id::text, a.name,
           v.balance_cents::text AS computed
      FROM v_account_balances_computed v
      JOIN accounts a ON a.account_id = v.account_id
     WHERE a.book_id = $1`, [bookId]);
  const openingByAcct = new Map<string, bigint>();
  for (const a of data.accounts) {
    openingByAcct.set(fixtureId("chen" === a.account_id ? "chen" : ctxPersona(bookId), "account", a.account_id), BigInt(a.opening_balance_cents));
  }
  // simpler: expected current per account uuid
  const expected = new Map<string, bigint>();
  const persona = ctxPersona(bookId);
  for (const a of data.accounts) {
    expected.set(fixtureId(persona, "account", a.account_id), BigInt(a.balance_cents));
  }
  let mismatches = 0;
  for (const row of bal.rows) {
    const exp = expected.get(row.account_id);
    if (exp === undefined) continue;
    if (BigInt(row.computed) !== exp) {
      console.error(`  BALANCE MISMATCH ${row.account_id}: computed=${row.computed} expected=${exp}`);
      mismatches++;
    }
  }

  // 2. unbalanced transactions must be zero
  const unb = await client.query<{ c: string }>(
    "SELECT count(*)::text AS c FROM v_unbalanced_transactions WHERE book_id = $1", [bookId]);

  // 3. null-leg check: every entry has a resolvable ledger account (structural)
  const cnt = await client.query<{ txns: string; entries: string }>(`
    SELECT
      (SELECT count(*)::text FROM transactions WHERE book_id = $1) AS txns,
      (SELECT count(*)::text FROM transaction_entries e
        JOIN transactions t ON t.transaction_id = e.transaction_id
       WHERE t.book_id = $1) AS entries`, [bookId]);

  console.log(`imported: ${cnt.rows[0]!.txns} transactions, ${cnt.rows[0]!.entries} entries`);
  console.log(`unbalanced: ${unb.rows[0]!.c} (expect 0)`);
  console.log(`balance mismatches: ${mismatches} (expect 0)`);
  if (unb.rows[0]!.c !== "0" || mismatches > 0) {
    throw new Error("verification failed — see output above");
  }
}

// ---------------------------------------------------------------------------
// mapping helpers
// ---------------------------------------------------------------------------

function ctxPersona(bookId: string): string {
  // fixtureId v5 of "chen:book:chen" vs "me:book:me" — just re-derive
  return bookId === fixtureId("chen", "book", "chen") ? "chen" : "me";
}

function accountUuid(persona: string, id: string | null | undefined): string | null {
  return id ? fixtureId(persona, "account", id) : null;
}

/** fixture account_type -> schema CHECK domain (LOAN -> CREDIT, subtype keeps detail). */
function mapAccountType(t: string): string {
  if (t === "LOAN") return "CREDIT";
  return t;
}

function resolveLedgerAccount(persona: string, key: string): string {
  if (key.startsWith("acct:")) return fixtureId(persona, "ledger_account", key.slice(5));
  if (key.startsWith("cat:")) return fixtureId(persona, "ledger_account", `cat:${key.slice(4)}`);
  throw new Error(`unresolvable ledgerAccountKey: ${key}`);
}

function categoryCode(t: any): string | null {
  const c = t.category_id;
  if (!c) return null;
  // TRANSFER/REIMBURSEMENT are not real categories in the seed
  if (c === "TRANSFER" || c === "REIMBURSEMENT") return null;
  return c;
}

function classFor(a: any): string {
  return a.normal_side === "LIABILITY" ? "LIABILITY" : "ASSET";
}
function normalSideFor(a: any): "DEBIT" | "CREDIT" {
  return a.normal_side === "LIABILITY" ? "CREDIT" : "DEBIT";
}
function coaCodeFor(a: any): string {
  return a.normal_side === "LIABILITY" ? `2${pad(seqOf(a))}` : `1${pad(seqOf(a))}`;
}
const seqMap = new Map<string, number>();
function seqOf(a: any): number {
  if (!seqMap.has(a.account_id)) seqMap.set(a.account_id, seqMap.size + 1);
  return seqMap.get(a.account_id)!;
}
function pad(n: number): string {
  return String(n).padStart(3, "0");
}
function liquidityFor(subtype: string): string {
  const map: Record<string, string> = {
    BANK_CHECKING: "INSTANT", CASH_WALLET: "INSTANT", ALIPAY_BALANCE: "INSTANT",
    WECHAT_BALANCE: "INSTANT", DIGITAL_WALLET: "INSTANT", BANK_SAVINGS: "HIGH",
    BROKERAGE: "HIGH", BANK_FIXED_DEPOSIT: "TERM", HOUSING_PROVIDENT_FUND: "TERM",
    CREDIT_CARD: "INSTANT", MORTGAGE: "ILLIQUID", CREDIT_CARD_INSTALLMENT: "INSTANT",
    RECEIVABLE: "LOW",
  };
  return map[subtype] ?? "LOW";
}
function assetClassFor(type: string): string {
  const map: Record<string, string> = { "股票": "EQUITY", "ETF": "ETF", "债券基金": "FUND", "基金": "FUND", "现金等价": "CASH_EQUIVALENT" };
  return map[type] ?? "OTHER";
}
function earliestTxnDate(data: any): string {
  return data.transactions.reduce((min: string, t: any) => (t.transaction_date < min ? t.transaction_date : min), data.transactions[0].transaction_date);
}
function latestTxnDate(data: any): string {
  return data.transactions.reduce((max: string, t: any) => (t.transaction_date > max ? t.transaction_date : max), data.transactions[0].transaction_date);
}

const isCli = import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isCli) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
