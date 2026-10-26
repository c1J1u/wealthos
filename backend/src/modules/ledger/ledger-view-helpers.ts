/**
 * Shared read helpers for /views pages (entity slices at one as-of mark).
 */
import type { PoolClient } from "pg";
import { accountBalancesAsOf, positionsAsOf, stockFigures } from "../analytics/balances.js";
import { monthEnd, monthsBetween } from "../analytics/period.js";
import { createHash } from "node:crypto";

export interface ViewHelpers {
  accounts(): Promise<unknown[]>;
  positions(): Promise<unknown[]>;
  recentTransactions(limit: number, types?: string[], period?: string): Promise<unknown[]>;
  categories(kind: "INCOME" | "EXPENSE"): Promise<unknown[]>;
  snapshots(fromMonth: string): Promise<unknown[]>;
  /** category composition for one period (income or expense side) */
  composition(kind: "INCOME" | "EXPENSE", period: string): Promise<unknown[]>;
  /** asset/liability group composition at asOf */
  assetComposition(): Promise<unknown[]>;
  /** transaction summary over a period (full scope, not a page) */
  summary(period: string, types?: string[]): Promise<unknown>;
  /** transaction summary over the full /transactions filter scope */
  filteredSummary(query: Record<string, string | undefined>): Promise<unknown>;
  /** recurring income + source concentration for one period */
  incomeStability(period: string): Promise<unknown>;
  /** fixed vs variable expenses + reimbursement tracking for one period */
  expenseRegularity(period: string): Promise<unknown>;
}

interface TxnRow {
  transaction_id: string; transaction_type: string; amount_cents: string;
  currency: string; transaction_date: string; posting_date: string;
  status: string; reconciliation_status: string; data_state: string;
  source_account_id: string | null; destination_account_id: string | null;
  credit_account_id: string | null; category_code: string | null;
  merchant_name: string | null; description: string | null;
  related_transaction_id: string | null; voided_by_transaction_id: string | null;
  created_at: Date; updated_at: Date; version: number;
}

export function makeViewHelpers(
  client: PoolClient,
  bookId: string,
  asOf: string,
): ViewHelpers {
  const ENTRY_SELECT = `
    SELECT e.entry_id::text, e.transaction_id::text, e.line_no, e.direction,
           e.amount_cents::text AS amount_cents, e.ledger_account_id::text,
           la.code AS ledger_account_code, la.name AS ledger_account_name,
           la.account_id::text AS account_id,
           e.flow_effect, e.entry_role, e.expense_bucket
      FROM transaction_entries e
      JOIN ledger_accounts la ON la.ledger_account_id = e.ledger_account_id`;

  async function loadEntries(ids: string[]): Promise<Map<string, unknown[]>> {
    const byTxn = new Map<string, unknown[]>();
    if (ids.length === 0) return byTxn;
    const r = await client.query(
      `${ENTRY_SELECT} WHERE e.transaction_id = ANY($1::uuid[]) ORDER BY e.transaction_id, e.line_no`,
      [ids],
    );
    for (const row of r.rows) {
      const list = byTxn.get(row.transaction_id) ?? [];
      list.push({
        entry_id: row.entry_id, transaction_id: row.transaction_id,
        line_no: row.line_no, direction: row.direction,
        amount_cents: Number(row.amount_cents),
        ledger_account_id: row.ledger_account_id,
        ledger_account_code: row.ledger_account_code,
        account_id: row.account_id, flow_effect: row.flow_effect,
        entry_role: row.entry_role, expense_bucket: row.expense_bucket,
        principal_cents: null, gain_cents: null, memo: null,
        currency: "CNY", base_amount_cents: Number(row.amount_cents),
      });
      byTxn.set(row.transaction_id, list);
    }
    return byTxn;
  }

  const DISPLAY_EFFECT: Record<string, string> = {
    INCOME: "INFLOW", DIVIDEND_RECEIVED: "INFLOW", INTEREST_RECEIVED: "INFLOW",
    REFUND: "INFLOW", REIMBURSEMENT: "INFLOW",
    EXPENSE: "OUTFLOW", CREDIT_CARD_PURCHASE: "OUTFLOW", LOAN_REPAYMENT: "OUTFLOW",
    CREDIT_CARD_REPAYMENT: "OUTFLOW", FEE_CHARGED: "OUTFLOW",
  };

  function txnDto(r: TxnRow, entries: unknown[]): Record<string, unknown> {
    return {
      transaction_id: r.transaction_id,
      transaction_type: r.transaction_type,
      amount_cents: Number(r.amount_cents),
      currency: r.currency,
      transaction_date: r.transaction_date,
      posting_date: r.posting_date,
      status: r.voided_by_transaction_id ? "VOIDED" : r.status,
      reconciliation_status: r.reconciliation_status,
      data_state: r.data_state,
      source_account_id: r.source_account_id,
      destination_account_id: r.destination_account_id,
      credit_account_id: r.credit_account_id,
      category_code: r.category_code,
      merchant_name: r.merchant_name,
      description: r.description,
      related_transaction_id: r.related_transaction_id,
      voided_by_transaction_id: r.voided_by_transaction_id,
      display_effect: DISPLAY_EFFECT[r.transaction_type] ?? "NEUTRAL",
      display_effect_version: "1.0",
      created_at: r.created_at,
      updated_at: r.updated_at,
      version: r.version,
      entries,
    };
  }

  return {
    async accounts() {
      const balances = await accountBalancesAsOf(client, bookId, asOf);
      return balances.map((b) => ({
        account_id: b.account_id, name: b.name, type: b.type, subtype: b.subtype,
        institution_name: b.institution_name, currency: b.currency,
        normal_side: b.normal_side, include_in_net_worth: b.include_in_net_worth,
        is_restricted: b.is_restricted, liquidity_level: b.liquidity_level,
        status: b.status, balance_cents: Number(b.balance_cents),
        available_balance_cents: null, data_state: b.data_state, version: b.version,
      }));
    },

    async positions() {
      const rows = await positionsAsOf(client, bookId, asOf);
      return rows.map((p) => ({
        position_id: p.position_id, instrument_id: p.instrument_id,
        account_id: p.account_id, ticker: p.ticker, instrument_name: p.instrument_name,
        asset_class: p.asset_class, quantity: Number(p.quantity),
        average_cost_cents: Number(p.average_cost_cents),
        total_cost_basis_cents: Number(p.total_cost_basis_cents),
        latest_price_cents: p.latest_price_cents === null ? null : Number(p.latest_price_cents),
        latest_price_as_of: p.latest_price_as_of,
        latest_price_source: p.latest_price_source,
        market_value_cents: p.market_value_cents === null ? null : Number(p.market_value_cents),
        na_reason: p.market_value_cents === null ? "NO_MARKET_PRICE" : null,
      }));
    },

    async recentTransactions(limit, types, period) {
      const params: unknown[] = [];
      let typeFilter = "";
      if (types && types.length > 0) {
        params.push(types);
        typeFilter = `AND t.transaction_type = ANY($${params.length})`;
      }
      // period-scoped: a view's embedded list serves its month only — an
      // empty period yields an empty list, never stale cross-month rows
      let periodFilter = "";
      if (period) {
        params.push(period);
        const p = params.length;
        periodFilter = `AND to_char(t.transaction_date, 'YYYY-MM') = $${p}`;
      }
      const r = await client.query<TxnRow>(
        `SELECT t.transaction_id::text, t.transaction_type, t.amount_cents::text,
                t.currency, t.transaction_date::text, t.posting_date::text,
                t.status, t.reconciliation_status, t.data_state,
                t.source_account_id::text, t.destination_account_id::text,
                t.credit_account_id::text, t.category_code,
                t.merchant_name, t.description,
                t.related_transaction_id::text, t.voided_by_transaction_id::text,
                t.created_at, t.updated_at, t.version
           FROM transactions t
          WHERE t.status != 'DRAFT' ${typeFilter} ${periodFilter}
          ORDER BY t.transaction_date DESC, t.transaction_id DESC
          LIMIT ${limit}`,
        params,
      );
      const entries = await loadEntries(r.rows.map((x) => x.transaction_id));
      return r.rows.map((x) => txnDto(x, entries.get(x.transaction_id) ?? []));
    },

    async categories(kind) {
      const r = await client.query(
        `SELECT category_code, parent_code, name_zh, name_en, kind, default_necessity
           FROM categories WHERE archived_at IS NULL AND kind = $1
           ORDER BY category_code`,
        [kind],
      );
      return r.rows;
    },

    async snapshots(fromMonth) {
      const bounds = await client.query<{ first: string | null; last: string | null }>(
        `SELECT to_char(min(transaction_date), 'YYYY-MM') AS first,
                to_char(max(transaction_date), 'YYYY-MM') AS last
           FROM transactions
          WHERE book_id = $1::uuid AND status IN ('POSTED','RECONCILED')`,
        [bookId],
      );
      const firstData = bounds.rows[0]?.first;
      const lastData = bounds.rows[0]?.last;
      if (!firstData || !lastData) return [];
      const lo = fromMonth > firstData ? fromMonth : firstData;
      const hi = lastData;
      if (lo > hi) return [];
      const out = [];
      for (const m of monthsBetween(lo, hi)) {
        const end = monthEnd(m);
        const st = await stockFigures(client, bookId, end);
        out.push({
          snapshot_id: snapshotId(bookId, m),
          as_of: end,
          total_assets_cents: Number(st.total_assets_cents),
          total_liabilities_cents: Number(st.total_liabilities_cents),
          net_worth_cents: Number(st.net_worth_cents),
          cash_reserve_cents: Number(st.cash_reserve_cents),
          liquid_assets_cents: Number(st.liquid_assets_cents),
          formula_version: "1.0",
          computed_at: new Date().toISOString(),
        });
      }
      out.reverse();
      return out;
    },

    async composition(kind, period) {
      // sign relative to the account's normal side: expenses net on DEBIT,
      // income on CREDIT; refunds credit back into their expense category.
      const r = await client.query<{ label: string; amount: string }>(
        `SELECT COALESCE(c.name_zh, la.code) AS label,
                SUM(CASE WHEN e.direction = la.normal_side THEN e.amount_cents ELSE -e.amount_cents END)::text AS amount
           FROM transaction_entries e
           JOIN transactions t ON t.transaction_id = e.transaction_id
           JOIN ledger_accounts la ON la.ledger_account_id = e.ledger_account_id
           LEFT JOIN categories c ON c.category_code = la.category_code
          WHERE t.book_id = $1::uuid
            AND t.status IN ('POSTED','RECONCILED')
            AND t.data_state = 'ACTUAL'
            AND to_char(t.transaction_date, 'YYYY-MM') = $2
            AND la.class = $3 AND e.entry_role = 'PRIMARY'
          GROUP BY 1 ORDER BY 2 DESC`,
        [bookId, period, kind],
      );
      const total = r.rows.reduce((s, x) => s + BigInt(x.amount), 0n);
      return r.rows
        .filter((x) => BigInt(x.amount) !== 0n)
        .map((x) => ({
          label: x.label,
          amount_cents: Number(x.amount),
          share: total === 0n ? null : Number(x.amount) / Number(total),
          data_state: "ACTUAL",
        }));
    },

    async assetComposition() {
      const balances = await accountBalancesAsOf(client, bookId, asOf);
      const positions = await positionsAsOf(client, bookId, asOf);
      const groups = new Map<string, bigint>();
      for (const b of balances) {
        if (!b.include_in_net_worth) continue;
        const key = b.normal_side === "ASSET" ? `资产 · ${b.subtype}` : `负债 · ${b.subtype}`;
        groups.set(key, (groups.get(key) ?? 0n) + b.balance_cents);
      }
      const posValued = positions.reduce((s, p) => s + (p.market_value_cents ?? 0n), 0n);
      if (posValued > 0n) groups.set("资产 · 持仓市值", posValued);
      const total = [...groups.values()].reduce((s, v) => s + (v < 0n ? -v : v), 0n);
      return [...groups.entries()]
        .sort((a, b) => (b[1] > a[1] ? 1 : -1))
        .map(([label, amount]) => ({
          label,
          amount_cents: Number(amount),
          share: total === 0n ? null : Math.abs(Number(amount)) / Number(total),
          data_state: "ACTUAL",
        }));
    },

    async summary(period, types) {
      const params: unknown[] = [bookId, period];
      let typeFilter = "";
      if (types && types.length > 0) {
        params.push(types);
        typeFilter = `AND t.transaction_type = ANY($${params.length})`;
      }
      const r = await client.query<{ c: string; inflow: string; outflow: string }>(
        `SELECT count(*)::text AS c,
                COALESCE(SUM(CASE WHEN t.amount_cents > 0 AND t.transaction_type IN
                  ('INCOME','DIVIDEND_RECEIVED','INTEREST_RECEIVED','REFUND','REIMBURSEMENT')
                  THEN t.amount_cents ELSE 0 END), 0)::text AS inflow,
                COALESCE(SUM(CASE WHEN t.transaction_type IN
                  ('EXPENSE','CREDIT_CARD_PURCHASE','LOAN_REPAYMENT','CREDIT_CARD_REPAYMENT','FEE_CHARGED')
                  THEN t.amount_cents ELSE 0 END), 0)::text AS outflow
           FROM transactions t
          WHERE t.book_id = $1::uuid
            AND t.status IN ('POSTED','RECONCILED')
            AND to_char(t.transaction_date, 'YYYY-MM') = $2
            ${typeFilter}`,
        params,
      );
      const row = r.rows[0]!;
      return {
        count: Number(row.c),
        inflow_cents: Number(row.inflow),
        outflow_cents: Number(row.outflow),
        period,
      };
    },

    async filteredSummary(query) {
      // same WHERE semantics as GET /transactions — the summary describes
      // the whole filtered scope, never the current page slice
      const q = query;
      const params: unknown[] = [];
      const where: string[] = ["t.status != 'DRAFT'"];
      if (q.type) { params.push(q.type); where.push(`t.transaction_type = $${params.length}`); }
      if (q.status) {
        if (q.status === "VOIDED") where.push("t.voided_by_transaction_id IS NOT NULL");
        else {
          params.push(q.status);
          where.push(`t.status = $${params.length} AND t.voided_by_transaction_id IS NULL`);
        }
      }
      if (q.reconciliation) { params.push(q.reconciliation); where.push(`t.reconciliation_status = $${params.length}`); }
      if (q.data_state) { params.push(q.data_state); where.push(`t.data_state = $${params.length}`); }
      if (q.from) { params.push(q.from); where.push(`t.transaction_date >= $${params.length}::date`); }
      if (q.to) { params.push(q.to); where.push(`t.transaction_date <= $${params.length}::date`); }
      if (q.account_id) {
        params.push(q.account_id);
        const p = params.length;
        where.push(`(t.source_account_id = $${p}::uuid
                     OR t.destination_account_id = $${p}::uuid
                     OR t.credit_account_id = $${p}::uuid
                     OR EXISTS (
                       SELECT 1 FROM transaction_entries e2
                         JOIN ledger_accounts la2 ON la2.ledger_account_id = e2.ledger_account_id
                        WHERE e2.transaction_id = t.transaction_id
                          AND la2.account_id = $${p}::uuid))`);
      }
      if (q.category_code) { params.push(q.category_code); where.push(`t.category_code = $${params.length}`); }
      if (q.q) {
        params.push(`%${q.q}%`);
        where.push(`(t.merchant_name ILIKE $${params.length} OR t.description ILIKE $${params.length})`);
      }
      const r = await client.query<{ c: string; inflow: string; outflow: string; first: string | null; last: string | null }>(
        `SELECT count(*)::text AS c,
                COALESCE(SUM(CASE WHEN t.transaction_type IN
                  ('INCOME','DIVIDEND_RECEIVED','INTEREST_RECEIVED','REFUND','REIMBURSEMENT')
                  THEN t.amount_cents ELSE 0 END), 0)::text AS inflow,
                COALESCE(SUM(CASE WHEN t.transaction_type IN
                  ('EXPENSE','CREDIT_CARD_PURCHASE','LOAN_REPAYMENT','CREDIT_CARD_REPAYMENT','FEE_CHARGED')
                  THEN t.amount_cents ELSE 0 END), 0)::text AS outflow,
                to_char(min(t.transaction_date), 'YYYY-MM') AS first,
                to_char(max(t.transaction_date), 'YYYY-MM') AS last
           FROM transactions t
          WHERE ${where.join(" AND ")}`,
        params,
      );
      const row = r.rows[0]!;
      return {
        count: Number(row.c),
        inflow_cents: Number(row.inflow),
        outflow_cents: Number(row.outflow),
        period: null,
        scope: {
          from: q.from ?? null,
          to: q.to ?? null,
          type: q.type ?? null,
          account_id: q.account_id ?? null,
          category_code: q.category_code ?? null,
          status: q.status ?? null,
          reconciliation: q.reconciliation ?? null,
          data_state: q.data_state ?? null,
          q: q.q ?? null,
          first_month: row.first,
          last_month: row.last,
        },
      };
    },

    async incomeStability(period) {
      const r = await client.query<{
        recurring: string; one_off: string;
        top_label: string | null; top_amount: string | null; sources: string;
      }>(
        `WITH inc AS (
           SELECT t.transaction_id, t.amount_cents, t.is_recurring,
                  COALESCE(t.merchant_name, t.description, c.name_zh, '未命名来源') AS source_label
             FROM transactions t
             LEFT JOIN categories c ON c.category_code = t.category_code
            WHERE t.book_id = $1::uuid
              AND t.status IN ('POSTED','RECONCILED')
              AND t.data_state = 'ACTUAL'
              AND to_char(t.transaction_date, 'YYYY-MM') = $2
              AND t.transaction_type IN ('INCOME','DIVIDEND_RECEIVED','INTEREST_RECEIVED')
         ), by_source AS (
           SELECT source_label, SUM(amount_cents) AS total
             FROM inc GROUP BY 1 ORDER BY 2 DESC
         )
         SELECT
           COALESCE(SUM(amount_cents) FILTER (WHERE is_recurring), 0)::text AS recurring,
           COALESCE(SUM(amount_cents) FILTER (WHERE NOT is_recurring), 0)::text AS one_off,
           (SELECT source_label FROM by_source LIMIT 1) AS top_label,
           (SELECT total::text FROM by_source LIMIT 1) AS top_amount,
           (SELECT count(*)::text FROM by_source) AS sources
           FROM inc`,
        [bookId, period],
      );
      const row = r.rows[0]!;
      const total = Number(row.recurring) + Number(row.one_off);
      return {
        period,
        recurring_income_cents: Number(row.recurring),
        one_off_income_cents: Number(row.one_off),
        source_count: Number(row.sources),
        top_source_label: row.top_label,
        top_source_amount_cents: row.top_amount === null ? null : Number(row.top_amount),
        top_source_share: row.top_amount === null || total === 0
          ? null
          : Number(row.top_amount) / total,
      };
    },

    async expenseRegularity(period) {
      const fixed = await client.query<{ fixed: string; variable: string; reimbursable: string }>(
        `SELECT
           COALESCE(SUM(amount_cents) FILTER (WHERE is_recurring), 0)::text AS fixed,
           COALESCE(SUM(amount_cents) FILTER (WHERE NOT is_recurring), 0)::text AS variable,
           COALESCE(SUM(amount_cents) FILTER (WHERE reimbursable), 0)::text AS reimbursable
           FROM transactions
          WHERE book_id = $1::uuid
            AND status IN ('POSTED','RECONCILED')
            AND data_state = 'ACTUAL'
            AND to_char(transaction_date, 'YYYY-MM') = $2
            AND transaction_type IN ('EXPENSE','CREDIT_CARD_PURCHASE')`,
        [bookId, period],
      );
      const received = await client.query<{ v: string }>(
        `SELECT COALESCE(SUM(amount_cents), 0)::text AS v
           FROM transactions
          WHERE book_id = $1::uuid
            AND status IN ('POSTED','RECONCILED')
            AND to_char(transaction_date, 'YYYY-MM') = $2
            AND transaction_type IN ('REFUND','REIMBURSEMENT')`,
        [bookId, period],
      );
      const f = fixed.rows[0]!;
      return {
        period,
        fixed_expense_cents: Number(f.fixed),
        variable_expense_cents: Number(f.variable),
        reimbursable_expense_cents: Number(f.reimbursable),
        reimbursement_received_cents: Number(received.rows[0]!.v),
      };
    },
  };
}

function snapshotId(bookId: string, month: string): string {
  const h = createHash("sha256").update(`${bookId}:snapshot:${month}`).digest("hex");
  return [h.slice(0, 8), h.slice(8, 12), h.slice(12, 16), h.slice(16, 20), h.slice(20, 32)].join("-");
}

// re-export under the name the views route imports
export { makeViewHelpers as registerLedgerRoutesHelpers };
