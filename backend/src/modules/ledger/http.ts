/**
 * Ledger read routes: accounts, transactions (+filters), entries, categories,
 * bootstrap. Entries always carry the full contract shape; every documented
 * filter is implemented server-side.
 */
import type { FastifyInstance } from "fastify";
import type { PoolClient } from "pg";
import { ok, errors, paginate, ApiError } from "../../http/envelope.js";
import { withBookTx, withBookWriteTx } from "../../http/db.js";
import { assertQuery, parseDate, parseLimit } from "../../http/query.js";
import { accountBalancesAsOf, type AccountBalanceRow } from "../analytics/balances.js";
import {
  createTransaction, voidTransaction, checkIdempotency,
  storeIdempotencyResponse, requestHashOf,
} from "./commands.js";
import { registerPreviewRoute } from "./preview.js";

// ---------------------------------------------------------------------------
// display_effect (Ruling B-16): server-side, versioned, by transaction type
// ---------------------------------------------------------------------------

const DISPLAY_EFFECT: Record<string, "INFLOW" | "OUTFLOW" | "NEUTRAL"> = {
  INCOME: "INFLOW",
  DIVIDEND_RECEIVED: "INFLOW",
  INTEREST_RECEIVED: "INFLOW",
  REFUND: "INFLOW",
  REIMBURSEMENT: "INFLOW",
  EXPENSE: "OUTFLOW",
  CREDIT_CARD_PURCHASE: "OUTFLOW",
  LOAN_REPAYMENT: "OUTFLOW",
  CREDIT_CARD_REPAYMENT: "OUTFLOW",
  FEE_CHARGED: "OUTFLOW",
  TRANSFER: "NEUTRAL",
  DEPOSIT_OPEN: "NEUTRAL",
  DEPOSIT_MATURITY: "NEUTRAL",
  DEPOSIT_RENEWAL: "NEUTRAL",
  INVESTMENT_BUY: "NEUTRAL",
  INVESTMENT_SELL: "NEUTRAL",
  LOAN_DISBURSEMENT: "NEUTRAL",
  ASSET_REVALUATION: "NEUTRAL",
  LIABILITY_ADJUSTMENT: "NEUTRAL",
  CURRENCY_EXCHANGE: "NEUTRAL",
  OTHER_ADJUSTMENT: "NEUTRAL",
};
export const DISPLAY_EFFECT_VERSION = "1.0";

// ---------------------------------------------------------------------------
// DTO mappers
// ---------------------------------------------------------------------------

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

interface EntryRow {
  entry_id: string; transaction_id: string; line_no: number;
  direction: "DEBIT" | "CREDIT"; amount_cents: string;
  ledger_account_id: string; ledger_account_code: string;
  ledger_account_name: string; account_id: string | null;
  flow_effect: string; entry_role: "PRIMARY" | "FUNDING" | "MEMO";
  expense_bucket: string | null;
}

const ENTRY_SELECT = `
  SELECT e.entry_id::text, e.transaction_id::text, e.line_no, e.direction,
         e.amount_cents::text AS amount_cents,
         e.ledger_account_id::text, la.code AS ledger_account_code,
         la.name AS ledger_account_name, la.account_id::text AS account_id,
         e.flow_effect, e.entry_role, e.expense_bucket
    FROM transaction_entries e
    JOIN ledger_accounts la ON la.ledger_account_id = e.ledger_account_id`;

async function loadEntries(client: PoolClient, ids: string[]): Promise<Map<string, unknown[]>> {
  const byTxn = new Map<string, unknown[]>();
  if (ids.length === 0) return byTxn;
  const r = await client.query<EntryRow>(
    `${ENTRY_SELECT}
     WHERE e.transaction_id = ANY($1::uuid[])
     ORDER BY e.transaction_id, e.line_no`,
    [ids],
  );
  for (const row of r.rows) {
    const list = byTxn.get(row.transaction_id) ?? [];
    list.push({
      entry_id: row.entry_id,
      transaction_id: row.transaction_id,
      line_no: row.line_no,
      direction: row.direction,
      amount_cents: Number(row.amount_cents),
      ledger_account_id: row.ledger_account_id,
      ledger_account_code: row.ledger_account_code,
      account_id: row.account_id,
      flow_effect: row.flow_effect,
      entry_role: row.entry_role,
      expense_bucket: row.expense_bucket,
      principal_cents: null,
      gain_cents: null,
      memo: null,
      currency: "CNY",
      base_amount_cents: Number(row.amount_cents),
    });
    byTxn.set(row.transaction_id, list);
  }
  return byTxn;
}

function txnDto(r: TxnRow, entries: unknown[]): Record<string, unknown> {
  const status = r.voided_by_transaction_id ? "VOIDED" : r.status;
  return {
    transaction_id: r.transaction_id,
    transaction_type: r.transaction_type,
    amount_cents: Number(r.amount_cents),
    currency: r.currency,
    transaction_date: r.transaction_date,
    posting_date: r.posting_date,
    status,
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
    display_effect: DISPLAY_EFFECT[r.transaction_type] ?? null,
    display_effect_version: DISPLAY_EFFECT_VERSION,
    created_at: r.created_at,
    updated_at: r.updated_at,
    version: r.version,
    entries,
  };
}

const TXN_SELECT = `
  SELECT t.transaction_id::text, t.transaction_type, t.amount_cents::text,
         t.currency, t.transaction_date::text, t.posting_date::text,
         t.status, t.reconciliation_status, t.data_state,
         t.source_account_id::text, t.destination_account_id::text,
         t.credit_account_id::text, t.category_code,
         t.merchant_name, t.description,
         t.related_transaction_id::text, t.voided_by_transaction_id::text,
         t.created_at, t.updated_at, t.version
    FROM transactions t
   WHERE t.status != 'DRAFT'`;

function accountDto(b: AccountBalanceRow): Record<string, unknown> {
  return {
    account_id: b.account_id,
    name: b.name,
    type: b.type,
    subtype: b.subtype,
    institution_name: b.institution_name,
    currency: b.currency,
    normal_side: b.normal_side,
    include_in_net_worth: b.include_in_net_worth,
    is_restricted: b.is_restricted,
    liquidity_level: b.liquidity_level,
    status: b.status,
    balance_cents: Number(b.balance_cents),
    available_balance_cents: null,
    opened_at: null,
    closed_at: null,
    data_state: b.data_state,
    version: b.version,
  };
}

// ---------------------------------------------------------------------------

export function registerLedgerRoutes(app: FastifyInstance): void {
  registerPreviewRoute(app);
  // ---- accounts ----------------------------------------------------------
  app.get("/v1/accounts", async (req) => {
    assertQuery(req, ["as_of", "limit", "cursor", "include_archived"]);
    const asOf = parseDate(req, "as_of") ?? new Date().toISOString().slice(0, 10);
    const limit = parseLimit(req);
    return withBookTx(app, req, async (client) => {
      const balances = await accountBalancesAsOf(client, req.session.bookId, asOf);
      const { page, next_cursor } = paginate(balances, limit, (b) => b.account_id);
      return ok(page.map(accountDto), { as_of: asOf, next_cursor });
    });
  });

  app.get("/v1/accounts/:id", async (req) => {
    assertQuery(req, ["as_of"]);
    const { id } = req.params as { id: string };
    const asOf = parseDate(req, "as_of") ?? new Date().toISOString().slice(0, 10);
    return withBookTx(app, req, async (client) => {
      const balances = await accountBalancesAsOf(client, req.session.bookId, asOf);
      const row = balances.find((b) => b.account_id === id);
      if (!row) throw errors.notFound("Account");
      return ok(accountDto(row), { as_of: asOf });
    });
  });

  app.get("/v1/accounts/:id/balance", async (req) => {
    assertQuery(req, ["as_of"]);
    const { id } = req.params as { id: string };
    const asOf = parseDate(req, "as_of") ?? new Date().toISOString().slice(0, 10);
    return withBookTx(app, req, async (client) => {
      const balances = await accountBalancesAsOf(client, req.session.bookId, asOf);
      const row = balances.find((b) => b.account_id === id);
      if (!row) throw errors.notFound("Account balance");
      return ok({
        account_id: row.account_id,
        as_of: asOf,
        normal_side: row.normal_side,
        debit_total_cents: Number(row.debit_total_cents),
        credit_total_cents: Number(row.credit_total_cents),
        balance_cents: Number(row.balance_cents),
        available_balance_cents: null,
        frozen_amount_cents: 0,
        computed: true,
      }, { as_of: asOf });
    });
  });

  app.get("/v1/accounts/:id/entries", async (req) => {
    assertQuery(req, ["from", "to", "limit", "cursor"]);
    const { id } = req.params as { id: string };
    const from = parseDate(req, "from");
    const to = parseDate(req, "to");
    const limit = parseLimit(req);
    return withBookTx(app, req, async (client) => {
      const params: unknown[] = [id];
      const where = ["la.account_id = $1::uuid", "t.status IN ('POSTED','RECONCILED')"];
      if (from) { params.push(from); where.push(`t.transaction_date >= $${params.length}::date`); }
      if (to) { params.push(to); where.push(`t.transaction_date <= $${params.length}::date`); }
      const r = await client.query(
        `${ENTRY_SELECT}
         JOIN transactions t ON t.transaction_id = e.transaction_id
          WHERE ${where.join(" AND ")}
          ORDER BY t.transaction_date DESC, t.transaction_id, e.line_no
          LIMIT ${limit + 1}`,
        params,
      );
      const hasMore = r.rows.length > limit;
      const rows = r.rows.slice(0, limit);
      const { page, next_cursor } = paginate(rows, limit, (x: EntryRow) => x.entry_id);
      return ok(page.map((row: EntryRow) => ({
        ...row,
        amount_cents: Number(row.amount_cents),
        base_amount_cents: Number(row.amount_cents),
        transaction_date: undefined,
      })).map(({ transaction_date: _drop, ...rest }: Record<string, unknown>) => ({
        ...rest,
        principal_cents: null, gain_cents: null, memo: null, currency: "CNY",
      })), { next_cursor: hasMore ? next_cursor : null });
    });
  });

  // ---- transactions ------------------------------------------------------
  app.get("/v1/transactions", async (req) => {
    assertQuery(req, [
      "type", "status", "account_id", "category_code", "q",
      "from", "to", "limit", "cursor", "reconciliation", "data_state",
    ]);
    const q = req.query as Record<string, string | undefined>;
    const limit = parseLimit(req);
    const from = parseDate(req, "from");
    const to = parseDate(req, "to");
    const cursor = q.cursor;

    return withBookTx(app, req, async (client) => {
      const params: unknown[] = [];
      const where: string[] = ["t.status != 'DRAFT'"];
      if (q.type) { params.push(q.type); where.push(`t.transaction_type = $${params.length}`); }
      if (q.status) {
        if (q.status === "VOIDED") {
          where.push("t.voided_by_transaction_id IS NOT NULL");
        } else {
          params.push(q.status);
          where.push(
            `t.status = $${params.length} AND t.voided_by_transaction_id IS NULL`,
          );
        }
      }
      if (q.reconciliation) {
        params.push(q.reconciliation);
        where.push(`t.reconciliation_status = $${params.length}`);
      }
      if (q.data_state) {
        if (q.data_state !== "ACTUAL" && q.data_state !== "ESTIMATE") {
          throw new ApiError({
            status: 400, code: "INVALID_DATA_STATE",
            title: "Invalid data_state", detail: "allowed: ACTUAL|ESTIMATE",
          });
        }
        params.push(q.data_state);
        where.push(`t.data_state = $${params.length}`);
      }
      if (from) { params.push(from); where.push(`t.transaction_date >= $${params.length}::date`); }
      if (to) { params.push(to); where.push(`t.transaction_date <= $${params.length}::date`); }
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
      if (cursor) {
        const sep = cursor.indexOf("|");
        if (sep === -1) {
          throw new ApiError({
            status: 400, code: "INVALID_CURSOR",
            title: "Invalid cursor", detail: "expected transaction_date|transaction_id",
          });
        }
        params.push(cursor.slice(0, sep), cursor.slice(sep + 1));
        where.push(
          `(t.transaction_date, t.transaction_id) < ($${params.length - 1}::date, $${params.length}::uuid)`,
        );
      }

      const r = await client.query<TxnRow>(
        `${TXN_SELECT} AND ${where.join(" AND ")}
         ORDER BY t.transaction_date DESC, t.transaction_id DESC
         LIMIT ${limit + 1}`,
        params,
      );
      const hasMore = r.rows.length > limit;
      const rows = r.rows.slice(0, limit);
      const entries = await loadEntries(client, rows.map((x) => x.transaction_id));
      const dtos = rows.map((x) => txnDto(x, entries.get(x.transaction_id) ?? []));
      return ok(dtos, {
        next_cursor: hasMore && rows.length > 0
          ? `${rows[rows.length - 1]!.transaction_date}|${rows[rows.length - 1]!.transaction_id}`
          : null,
      });
    });
  });

  app.get("/v1/transactions/:id", async (req) => {
    const { id } = req.params as { id: string };
    return withBookTx(app, req, async (client) => {
      const r = await client.query<TxnRow>(`${TXN_SELECT} AND t.transaction_id = $1::uuid`, [id]);
      const row = r.rows[0];
      if (!row) throw errors.notFound("Transaction");
      const entries = await loadEntries(client, [row.transaction_id]);
      return ok(txnDto(row, entries.get(row.transaction_id) ?? []));
    });
  });

  app.get("/v1/transactions/:id/entries", async (req) => {
    const { id } = req.params as { id: string };
    return withBookTx(app, req, async (client) => {
      const exists = await client.query(
        "SELECT 1 FROM transactions WHERE transaction_id = $1::uuid", [id],
      );
      if (exists.rows.length === 0) throw errors.notFound("Transaction");
      const entries = await loadEntries(client, [id]);
      return ok(entries.get(id) ?? []);
    });
  });

  app.post("/v1/transactions", async (req, reply) => {
    // P2 write command (2026-10-25): idempotent single-transaction create.
    const idempotencyKey = (req.headers as Record<string, string | undefined>)["idempotency-key"];
    if (!idempotencyKey) {
      throw errors.badRequest(
        "IDEMPOTENCY_KEY_REQUIRED",
        "writes require an Idempotency-Key header (FI-11)",
      );
    }
    const body = req.body as import("./commands.js").CreateTransactionCommand;
    const hash = requestHashOf(body);
    const result = await withBookWriteTx(app, req, async (client) => {
      const { replay } = await checkIdempotency(
        client, req.session.userId, idempotencyKey, hash,
      );
      if (replay) return replay;
      const created = await createTransaction(
        client,
        { bookId: req.session.bookId, userId: req.session.userId },
        body,
        idempotencyKey,
      );
      await storeIdempotencyResponse(
        client, req.session.userId, idempotencyKey, created,
      );
      return created;
    });
    if (result.replayed) reply.header("idempotency-replayed", "true");
    reply.code(201);
    return ok(result);
  });

  app.post("/v1/transactions/:id/void", async (req, reply) => {
    const idempotencyKey = (req.headers as Record<string, string | undefined>)["idempotency-key"];
    if (!idempotencyKey) {
      throw errors.badRequest(
        "IDEMPOTENCY_KEY_REQUIRED",
        "writes require an Idempotency-Key header (FI-11)",
      );
    }
    const { id } = req.params as { id: string };
    const body = req.body as { reason?: string; reversal_date?: string } | null;
    const reversalDate = body?.reversal_date ?? new Date().toISOString().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(reversalDate)) {
      throw errors.badRequest("VALIDATION_FAILED", "reversal_date must be YYYY-MM-DD");
    }
    const hash = requestHashOf({ id, body });
    const result = await withBookWriteTx(app, req, async (client) => {
      const { replay } = await checkIdempotency(
        client, req.session.userId, idempotencyKey, hash,
      );
      if (replay) return replay;
      const created = await voidTransaction(
        client,
        { bookId: req.session.bookId, userId: req.session.userId },
        id,
        reversalDate,
        body?.reason ?? null,
        idempotencyKey,
      );
      await storeIdempotencyResponse(
        client, req.session.userId, idempotencyKey, created,
      );
      return created;
    });
    if (result.replayed) reply.header("idempotency-replayed", "true");
    reply.code(201);
    return ok(result);
  });

  // ---- reference ---------------------------------------------------------
  app.get("/v1/categories", async (req) => {
    assertQuery(req, ["kind", "include_archived"]);
    const q = req.query as Record<string, string | undefined>;
    return withBookTx(app, req, async (client) => {
      const params: unknown[] = [];
      const where = ["archived_at IS NULL"];
      if (q.kind) {
        if (q.kind !== "INCOME" && q.kind !== "EXPENSE") {
          throw new ApiError({
            status: 400, code: "INVALID_KIND",
            title: "Invalid kind", detail: "allowed: INCOME|EXPENSE",
          });
        }
        params.push(q.kind);
        where.push(`kind = $${params.length}`);
      }
      const r = await client.query(
        `SELECT category_code, parent_code, name_zh, name_en, kind, default_necessity
           FROM categories WHERE ${where.join(" AND ")} ORDER BY kind, category_code`,
        params,
      );
      return ok(r.rows);
    });
  });

  app.get("/v1/entries", async (req) => {
    assertQuery(req, ["from", "to", "account_id", "limit", "cursor"]);
    const q = req.query as Record<string, string | undefined>;
    const limit = parseLimit(req);
    const from = parseDate(req, "from");
    const to = parseDate(req, "to");
    return withBookTx(app, req, async (client) => {
      const params: unknown[] = [];
      const where = ["t.status IN ('POSTED','RECONCILED')"];
      if (from) { params.push(from); where.push(`t.transaction_date >= $${params.length}::date`); }
      if (to) { params.push(to); where.push(`t.transaction_date <= $${params.length}::date`); }
      if (q.account_id) { params.push(q.account_id); where.push(`la.account_id = $${params.length}::uuid`); }
      const r = await client.query(
        `${ENTRY_SELECT}
         JOIN transactions t ON t.transaction_id = e.transaction_id
          WHERE ${where.join(" AND ")}
          ORDER BY t.transaction_date DESC, t.transaction_id, e.line_no
          LIMIT ${limit + 1}`,
        params,
      );
      const hasMore = r.rows.length > limit;
      const rows = r.rows.slice(0, limit);
      return ok(rows.map((row: EntryRow) => ({
        ...row,
        amount_cents: Number(row.amount_cents),
        base_amount_cents: Number(row.amount_cents),
        principal_cents: null, gain_cents: null, memo: null, currency: "CNY",
      })), { next_cursor: hasMore && rows.length ? rows[rows.length - 1]!.entry_id : null });
    });
  });

  // ---- bootstrap ----------------------------------------------------------
  app.get("/v1/bootstrap", async (req) => {
    assertQuery(req, ["from", "to", "include"]);
    return withBookTx(
      app,
      req,
      async (client) => {
        const asOf = new Date().toISOString().slice(0, 10);
        const balances = await accountBalancesAsOf(client, req.session.bookId, asOf);
        const categories = await client.query(
          `SELECT category_code, parent_code, name_zh, name_en, kind, default_necessity
             FROM categories WHERE archived_at IS NULL ORDER BY kind, category_code`,
        );
        const txns = await client.query<TxnRow>(
          `${TXN_SELECT}
           ORDER BY t.transaction_date DESC, t.transaction_id DESC LIMIT 200`,
        );
        const entries = await loadEntries(client, txns.rows.map((x) => x.transaction_id));
        const instruments = await client.query(
          `SELECT instrument_id::text, ticker, name, asset_class, currency
             FROM instruments ORDER BY ticker`,
        );
        const me = await client.query(
          `SELECT display_name FROM users WHERE user_id = $1::uuid`,
          [req.session.userId],
        );

        return {
          profile: {
            profile_id: req.session.persona,
            display_name: me.rows[0]?.display_name ?? "WealthOS",
            base_currency: "CNY",
          },
          accounts: balances.map(accountDto),
          categories: categories.rows,
          transactions: txns.rows.map((x) => txnDto(x, entries.get(x.transaction_id) ?? [])),
          instruments: instruments.rows,
          positions: [],
          assets: [],
          asset_valuations: [],
          snapshots: [],
          metrics: [],
        };
      },
      { repeatableRead: true },
    ).then((data) => ok(data, { as_of: new Date().toISOString().slice(0, 10) }));
  });
}
