/**
 * As-of balance engine. Every stock figure flows through here so the
 * posting_date <= as_of / price <= as_of replay rule (handoff P0-3) is
 * enforced in exactly one place.
 */
import type { PoolClient } from "pg";

export interface AccountBalanceRow {
  account_id: string;
  name: string;
  type: string;
  subtype: string;
  institution_name: string | null;
  currency: string;
  normal_side: "ASSET" | "LIABILITY";
  include_in_net_worth: boolean;
  is_restricted: boolean;
  liquidity_level: string;
  status: string;
  data_state: string;
  version: number;
  debit_total_cents: bigint;
  credit_total_cents: bigint;
  balance_cents: bigint;
}

/**
 * Balances for every account of the book, recomputed from entries with
 * posting_date <= asOf. One set-based query; no cache.
 */
export async function accountBalancesAsOf(
  client: PoolClient,
  bookId: string,
  asOf: string,
): Promise<AccountBalanceRow[]> {
  const r = await client.query<AccountBalanceRow>(
    `WITH scoped AS (
       SELECT e.ledger_account_id,
              SUM(CASE WHEN e.direction = 'DEBIT' THEN e.amount_cents ELSE 0 END) AS debit,
              SUM(CASE WHEN e.direction = 'CREDIT' THEN e.amount_cents ELSE 0 END) AS credit
         FROM transaction_entries e
         JOIN transactions t ON t.transaction_id = e.transaction_id
        WHERE t.status IN ('POSTED','RECONCILED')
          AND t.posting_date <= $2::date
        GROUP BY e.ledger_account_id
     )
     SELECT a.account_id::text, a.name, a.type, a.subtype, a.institution_name,
            a.currency, a.normal_side, a.include_in_net_worth, a.is_restricted,
            a.liquidity_level, a.status, a.data_state, a.version,
            COALESCE(s.debit, 0)::text AS debit_total_cents,
            COALESCE(s.credit, 0)::text AS credit_total_cents,
            (CASE a.normal_side
               WHEN 'ASSET' THEN COALESCE(s.debit, 0) - COALESCE(s.credit, 0)
               ELSE COALESCE(s.credit, 0) - COALESCE(s.debit, 0)
             END)::text AS balance_cents
       FROM accounts a
       JOIN ledger_accounts la ON la.account_id = a.account_id
       LEFT JOIN scoped s ON s.ledger_account_id = la.ledger_account_id
      WHERE a.book_id = $1::uuid
      ORDER BY a.normal_side, a.name`,
    [bookId, asOf],
  );
  // pg returns bigint sums as text; normalize to BigInt
  return r.rows.map((row) => ({
    ...row,
    debit_total_cents: BigInt(row.debit_total_cents as unknown as string),
    credit_total_cents: BigInt(row.credit_total_cents as unknown as string),
    balance_cents: BigInt(row.balance_cents as unknown as string),
  }));
}

export interface PositionRow {
  position_id: string;
  instrument_id: string;
  account_id: string;
  ticker: string;
  instrument_name: string;
  asset_class: string;
  quantity: string;
  average_cost_cents: bigint;
  total_cost_basis_cents: bigint;
  realized_pnl_cents: bigint;
  latest_price_cents: bigint | null;
  latest_price_as_of: string | null;
  latest_price_source: string | null;
  market_value_cents: bigint | null;
}

/**
 * Positions valued at the latest market price <= asOf. Positions without a
 * price are returned with null market value — never 0 (FI-16/FI-18).
 */
export async function positionsAsOf(
  client: PoolClient,
  bookId: string,
  asOf: string,
): Promise<PositionRow[]> {
  const r = await client.query(
    `SELECT p.position_id::text, p.instrument_id::text, p.account_id::text,
            i.ticker, i.name AS instrument_name, i.asset_class,
            p.quantity::text,
            p.average_cost_cents::text,
            p.total_cost_basis_cents::text,
            p.realized_pnl_cents::text,
            mp.price_cents::text AS latest_price_cents,
            mp.as_of::text AS latest_price_as_of,
            mp.source AS latest_price_source,
            CASE WHEN mp.price_cents IS NULL THEN NULL
                 ELSE (p.quantity * mp.price_cents)::bigint::text END AS market_value_cents
       FROM positions p
       JOIN instruments i ON i.instrument_id = p.instrument_id
       LEFT JOIN LATERAL (
         SELECT price_cents, as_of::text AS as_of, source
           FROM market_prices m
          WHERE m.instrument_id = p.instrument_id AND m.as_of <= $2::date
          ORDER BY m.as_of DESC LIMIT 1
       ) mp ON true
      WHERE p.book_id = $1::uuid
      ORDER BY i.ticker`,
    [bookId, asOf],
  );
  return r.rows.map((row: Record<string, string | null | undefined>) => ({
    position_id: row.position_id as string,
    instrument_id: row.instrument_id as string,
    account_id: row.account_id as string,
    ticker: row.ticker as string,
    instrument_name: row.instrument_name as string,
    asset_class: row.asset_class as string,
    quantity: row.quantity as string,
    average_cost_cents: BigInt(row.average_cost_cents as string),
    total_cost_basis_cents: BigInt(row.total_cost_basis_cents as string),
    realized_pnl_cents: BigInt(row.realized_pnl_cents as string),
    latest_price_cents: row.latest_price_cents == null ? null : BigInt(row.latest_price_cents),
    latest_price_as_of: row.latest_price_as_of ?? null,
    latest_price_source: row.latest_price_source ?? null,
    market_value_cents: row.market_value_cents == null ? null : BigInt(row.market_value_cents),
  }));
}

export interface StockFigures {
  account_assets_cents: bigint;
  positions_value_cents: bigint;
  non_account_assets_cents: bigint;
  total_assets_cents: bigint;
  total_liabilities_cents: bigint;
  net_worth_cents: bigint;
  cash_reserve_cents: bigint;
  liquid_assets_cents: bigint;
  restricted_assets_cents: bigint;
  /** instruments whose price exists at both marks, delta > 0 excluded */
  valuation_change_cents: bigint;
}

const CASH_EQUIVALENT = [
  "CASH_WALLET", "BANK_CHECKING", "BANK_SAVINGS",
  "ALIPAY_BALANCE", "WECHAT_BALANCE", "DIGITAL_WALLET",
];

/**
 * Stock figures at one as-of mark (FC-02 single-formula rule).
 * fromStart/toEnd are used only for valuation_change (Ruling B-12).
 */
export async function stockFigures(
  client: PoolClient,
  bookId: string,
  asOf: string,
  valuationWindow?: { from: string; to: string },
): Promise<StockFigures> {
  const balances = await accountBalancesAsOf(client, bookId, asOf);

  let accountAssets = 0n;
  let liabilities = 0n;
  let cash = 0n;
  let liquid = 0n;
  let restricted = 0n;
  for (const b of balances) {
    if (!b.include_in_net_worth) continue;
    if (b.normal_side === "ASSET") {
      accountAssets += b.balance_cents;
      if (b.is_restricted) restricted += b.balance_cents;
      if (!b.is_restricted && CASH_EQUIVALENT.includes(b.subtype)) cash += b.balance_cents;
      if (!b.is_restricted && (b.liquidity_level === "INSTANT" || b.liquidity_level === "HIGH")) {
        liquid += b.balance_cents;
      }
    } else {
      liabilities += b.balance_cents;
    }
  }

  const positions = await positionsAsOf(client, bookId, asOf);
  const positionsValue = positions.reduce((s, p) => s + (p.market_value_cents ?? 0n), 0n);

  // non-account assets: latest valuation <= asOf, account_id IS NULL
  const na = await client.query<{ v: string | null }>(
    `SELECT SUM(latest.market_value_cents)::text AS v
       FROM assets a
       JOIN LATERAL (
         SELECT market_value_cents FROM asset_valuations av
          WHERE av.asset_id = a.asset_id AND av.as_of <= $2::date
          ORDER BY av.as_of DESC LIMIT 1
       ) latest ON true
      WHERE a.book_id = $1::uuid AND a.account_id IS NULL`,
    [bookId, asOf],
  );
  const nonAccount = na.rows[0]?.v ? BigInt(na.rows[0].v) : 0n;

  // valuation change: only instruments priced at BOTH window marks (B-12)
  let valuationChange = 0n;
  if (valuationWindow) {
    const vc = await client.query<{ d: string | null }>(
      `WITH marks AS (
         SELECT p.instrument_id, p.quantity,
                (SELECT price_cents FROM market_prices m
                  WHERE m.instrument_id = p.instrument_id AND m.as_of <= $2::date
                  ORDER BY m.as_of DESC LIMIT 1) AS start_price,
                (SELECT price_cents FROM market_prices m
                  WHERE m.instrument_id = p.instrument_id AND m.as_of <= $3::date
                  ORDER BY m.as_of DESC LIMIT 1) AS end_price
           FROM positions p WHERE p.book_id = $1::uuid
       )
       SELECT SUM(round(quantity * (end_price - start_price)))::bigint::text AS d
         FROM marks
        WHERE start_price IS NOT NULL AND end_price IS NOT NULL`,
      [bookId, valuationWindow.from, valuationWindow.to],
    );
    valuationChange = vc.rows[0]?.d ? BigInt(vc.rows[0].d) : 0n;
  }

  const totalAssets = accountAssets + positionsValue + nonAccount;
  return {
    account_assets_cents: accountAssets,
    positions_value_cents: positionsValue,
    non_account_assets_cents: nonAccount,
    total_assets_cents: totalAssets,
    total_liabilities_cents: liabilities,
    net_worth_cents: totalAssets - liabilities,
    cash_reserve_cents: cash,
    liquid_assets_cents: liquid,
    restricted_assets_cents: restricted,
    valuation_change_cents: valuationChange,
  };
}

/** Human-readable exclusion notes for the balance sheet (excluded_assets). */
export async function balanceSheetExclusions(
  client: PoolClient,
  bookId: string,
  asOf: string,
): Promise<string[]> {
  const out: string[] = [];
  const excludedAccounts = await client.query<{ name: string }>(
    `SELECT name FROM accounts
      WHERE book_id = $1::uuid AND include_in_net_worth = false`,
    [bookId],
  );
  for (const row of excludedAccounts.rows) {
    out.push(`account:${row.name} (include_in_net_worth=false)`);
  }
  const positions = await positionsAsOf(client, bookId, asOf);
  for (const p of positions) {
    if (p.market_value_cents === null) {
      out.push(`position:${p.ticker} (no market price on or before ${asOf})`);
    }
  }
  const unvalued = await client.query<{ name: string }>(
    `SELECT a.name FROM assets a
      WHERE a.book_id = $1::uuid AND a.account_id IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM asset_valuations av
           WHERE av.asset_id = a.asset_id AND av.as_of <= $2::date)`,
    [bookId, asOf],
  );
  for (const row of unvalued.rows) {
    out.push(`asset:${row.name} (no valuation on or before ${asOf})`);
  }
  return out;
}
