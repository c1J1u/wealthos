/**
 * P2 write commands. Every command runs in ONE read-write transaction:
 * idempotency check → validation → entry templates → transaction + entries
 * → audit → outbox → idempotency result (FC-04 / FI-11 / FI-12).
 *
 * The connection is the non-owner app role: RLS applies to every write,
 * so commands physically cannot escape their book.
 */
import type { PoolClient } from "pg";
import { createHash, randomUUID } from "node:crypto";
import { buildEntries, SplitMismatchError } from "./entry-templates.js";
import { ApiError } from "../../http/envelope.js";

// ---------------------------------------------------------------------------
// command shape
// ---------------------------------------------------------------------------

export interface CreateTransactionCommand {
  transaction_type: string;
  amount_cents: number;
  transaction_date: string;
  posting_date?: string;
  source_account_id?: string | null;
  destination_account_id?: string | null;
  credit_account_id?: string | null;
  category_code?: string | null;
  merchant_name?: string | null;
  description?: string | null;
  data_state?: "ACTUAL" | "ESTIMATE";
  related_transaction_id?: string | null;
  repayment?: { principal_cents: number; interest_cents: number; fees_cents: number } | null;
  expense_meta?: { necessity_level?: string } | null;
}

export interface CommandResult {
  transaction_id: string;
  replayed: boolean;
}

const ALLOWED_TYPES = new Set([
  "INCOME", "EXPENSE", "TRANSFER", "CREDIT_CARD_PURCHASE", "CREDIT_CARD_REPAYMENT",
  "LOAN_DISBURSEMENT", "LOAN_REPAYMENT", "DEPOSIT_OPEN", "DEPOSIT_MATURITY",
  "DEPOSIT_RENEWAL", "INVESTMENT_BUY", "INVESTMENT_SELL", "DIVIDEND_RECEIVED",
  "INTEREST_RECEIVED", "FEE_CHARGED", "REFUND", "REIMBURSEMENT", "ASSET_REVALUATION",
  "LIABILITY_ADJUSTMENT", "CURRENCY_EXCHANGE", "OTHER_ADJUSTMENT",
]);

const AMOUNT_MAX = 100_000_000_000;

// ---------------------------------------------------------------------------
// idempotency (FI-11, B-20)
// ---------------------------------------------------------------------------

export async function checkIdempotency(
  client: PoolClient,
  userId: string,
  key: string,
  requestHash: string,
): Promise<{ replay: CommandResult | null }> {
  const r = await client.query(
    `SELECT request_hash, status, response_body FROM idempotency_keys
      WHERE user_id = $1::uuid AND key = $2`,
    [userId, key],
  );
  const row = r.rows[0];
  if (!row) {
    try {
      await client.query(
        `INSERT INTO idempotency_keys (user_id, key, request_hash, status, expires_at)
         VALUES ($1::uuid, $2, $3, 'IN_PROGRESS', now() + interval '24 hours')`,
        [userId, key, requestHash],
      );
    } catch (err) {
      if ((err as { code?: string }).code === "23505") {
        // concurrent insert won the race: fall through to the existing-row
        // handling below by re-reading
        const again = await client.query(
          `SELECT request_hash, status, response_body FROM idempotency_keys
            WHERE user_id = $1::uuid AND key = $2`,
          [userId, key],
        );
        return handleExisting(again.rows[0], key, requestHash);
      }
      throw err;
    }
    return { replay: null };
  }
  return handleExisting(row, key, requestHash);
}

function handleExisting(
  row: { request_hash: string; status: string; response_body: unknown } | undefined,
  key: string,
  requestHash: string,
): { replay: CommandResult | null } {
  if (!row) {
    throw new ApiError({
      status: 409, code: "IDEMPOTENCY_IN_PROGRESS",
      title: "Idempotency record vanished unexpectedly",
    });
  }
  if (row.request_hash !== requestHash) {
    throw new ApiError({
      status: 409, code: "IDEMPOTENCY_CONFLICT",
      title: "Idempotency key reused with a different request body",
      detail: `key=${key} was first used with another payload`,
    });
  }
  if (row.status === "IN_PROGRESS") {
    throw new ApiError({
      status: 409, code: "IDEMPOTENCY_IN_PROGRESS",
      title: "A request with this idempotency key is still in progress",
      detail: "retry shortly; the first response will be replayed",
    });
  }
  const body = row.response_body as { transaction_id?: string } | null;
  if (body?.transaction_id) {
    return { replay: { transaction_id: body.transaction_id, replayed: true } };
  }
  // COMPLETED but no body (legacy) — treat as conflict-free new attempt is
  // unsafe; surface it instead of guessing.
  throw new ApiError({
    status: 409, code: "IDEMPOTENCY_CONFLICT",
    title: "Idempotency record has no replayable response",
  });
}

export async function storeIdempotencyResponse(
  client: PoolClient,
  userId: string,
  key: string,
  result: CommandResult,
): Promise<void> {
  await client.query(
    `UPDATE idempotency_keys
        SET status = 'COMPLETED', response_status = 201, response_body = $3::jsonb
      WHERE user_id = $1::uuid AND key = $2`,
    [userId, key, JSON.stringify(result)],
  );
}

export function requestHashOf(body: unknown): string {
  return createHash("sha256").update(JSON.stringify(body)).digest("hex");
}

// ---------------------------------------------------------------------------
// validation helpers
// ---------------------------------------------------------------------------

async function assertAccountsInBook(
  client: PoolClient,
  ids: Array<string | null | undefined>,
): Promise<void> {
  for (const id of ids) {
    if (!id) continue;
    const r = await client.query(`SELECT 1 FROM accounts WHERE account_id = $1::uuid`, [id]);
    if (r.rows.length === 0) {
      throw new ApiError({
        status: 404, code: "ACCOUNT_NOT_FOUND",
        title: "Account not found in this book", detail: id,
      });
    }
  }
}

async function assertPeriodOpen(client: PoolClient, postingDate: string): Promise<void> {
  const r = await client.query(
    `SELECT 1 FROM period_locks
      WHERE period_start = date_trunc('month', $1::date)
        AND status = 'CLOSED'`,
    [postingDate],
  );
  if (r.rows.length > 0) {
    throw new ApiError({
      status: 422, code: "PERIOD_CLOSED",
      title: "The posting period is closed",
      detail: `period ${postingDate.slice(0, 7)} is closed for this book`,
    });
  }
}

async function resolveLedgerAccount(
  client: PoolClient,
  key: string,
): Promise<string> {
  if (key.startsWith("acct:")) {
    const r = await client.query(
      `SELECT ledger_account_id::text FROM ledger_accounts
        WHERE account_id = $1::uuid`,
      [key.slice(5)],
    );
    if (r.rows.length === 0) {
      throw new ApiError({
        status: 404, code: "LEDGER_ACCOUNT_NOT_FOUND",
        title: "No ledger account for this account", detail: key,
      });
    }
    return r.rows[0].ledger_account_id;
  }
  if (key.startsWith("cat:")) {
    const r = await client.query(
      `SELECT ledger_account_id::text FROM ledger_accounts
        WHERE category_code = $1`,
      [key.slice(4)],
    );
    if (r.rows.length === 0) {
      throw new ApiError({
        status: 404, code: "CATEGORY_NOT_FOUND",
        title: "Category not found in this book", detail: key.slice(4),
      });
    }
    return r.rows[0].ledger_account_id;
  }
  throw new ApiError({
    status: 400, code: "LEDGER_ACCOUNT_UNRESOLVABLE", title: "Bad ledger account key",
  });
}

// ---------------------------------------------------------------------------
// create transaction (the P2 core command)
// ---------------------------------------------------------------------------

export async function createTransaction(
  client: PoolClient,
  ctx: { bookId: string; userId: string },
  cmd: CreateTransactionCommand,
  idempotencyKey: string,
): Promise<CommandResult> {
  // ---- validation (before any write) ----
  if (!ALLOWED_TYPES.has(cmd.transaction_type)) {
    throw new ApiError({
      status: 400, code: "VALIDATION_FAILED",
      title: "Unknown transaction_type", detail: cmd.transaction_type,
    });
  }
  if (!Number.isInteger(cmd.amount_cents) || cmd.amount_cents <= 0 || cmd.amount_cents > AMOUNT_MAX) {
    throw new ApiError({
      status: 400, code: "VALIDATION_FAILED",
      title: "amount_cents must be a positive integer of at most 1e11 (FI-15)",
    });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cmd.transaction_date)) {
    throw new ApiError({
      status: 400, code: "VALIDATION_FAILED",
      title: "transaction_date must be YYYY-MM-DD",
    });
  }
  const postingDate = cmd.posting_date ?? cmd.transaction_date;
  await assertPeriodOpen(client, postingDate);
  await assertAccountsInBook(client, [
    cmd.source_account_id, cmd.destination_account_id, cmd.credit_account_id,
  ]);

  // N-05 normalization: credit card purchases post to the card account on
  // the destination side (schema CHECK requires it).
  const destinationAccountId =
    cmd.destination_account_id ??
    (cmd.transaction_type === "CREDIT_CARD_PURCHASE" ? cmd.credit_account_id ?? null : null);

  // ---- entry vector from the single source of truth ----
  let specs;
  try {
    specs = buildEntries({
      transaction_id: "pending",
      transaction_type: cmd.transaction_type,
      amount_cents: cmd.amount_cents,
      source_account_id: cmd.source_account_id ?? null,
      destination_account_id: destinationAccountId,
      credit_account_id: cmd.credit_account_id ?? null,
      category_id: cmd.category_code ?? null,
      repayment_meta: cmd.repayment ?? null,
      expense_meta: cmd.expense_meta ?? null,
    });
  } catch (err) {
    if (err instanceof SplitMismatchError) {
      throw new ApiError({
        status: 422, code: "SPLIT_MISMATCH",
        title: "principal + interest + fees must equal amount_cents (FC-03)",
        detail: err.message,
      });
    }
    throw new ApiError({
      status: 400, code: "VALIDATION_FAILED",
      title: "Command cannot produce a valid entry vector",
      detail: err instanceof Error ? err.message : String(err),
    });
  }

  const txnId = randomUUID();
  const auditId = randomUUID();
  const outboxId = randomUUID();

  // ---- transaction + entries ----
  try {
    await client.query(
      `INSERT INTO transactions (transaction_id, book_id, transaction_type, amount_cents,
           transaction_date, posting_date, status, source_account_id, destination_account_id,
           credit_account_id, category_code, merchant_name, description, data_state,
           source_type, related_transaction_id, idempotency_key)
       VALUES ($1,$2,$3,$4,$5,$6,'POSTED',$7,$8,$9,$10,$11,$12,$13,'MANUAL',$14,$15)`,
      [
        txnId, ctx.bookId, cmd.transaction_type, cmd.amount_cents,
        cmd.transaction_date, postingDate,
        cmd.source_account_id ?? null, destinationAccountId,
        cmd.credit_account_id ?? null, cmd.category_code ?? null,
        cmd.merchant_name ?? null, cmd.description ?? null,
        cmd.data_state ?? "ACTUAL",
        cmd.related_transaction_id ?? null, idempotencyKey,
      ],
    );
  } catch (err) {
    if ((err as { code?: string }).code === "23503") {
      throw new ApiError({
        status: 404, code: "CATEGORY_NOT_FOUND",
        title: "category_code does not exist in the reference data",
        detail: cmd.category_code ?? "(none)",
      });
    }
    throw err;
  }
  let line = 1;
  for (const s of specs) {
    const laId = await resolveLedgerAccount(client, s.ledgerAccountKey);
    await client.query(
      `INSERT INTO transaction_entries (entry_id, transaction_id, line_no, direction,
           amount_cents, ledger_account_id, flow_effect, entry_role, expense_bucket)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        randomUUID(), txnId, line++, s.direction, s.amount_cents.toString(),
        laId, s.flow_effect, s.entry_role, s.expense_bucket,
      ],
    );
  }

  // ---- audit (append-only) ----
  await client.query(
    `INSERT INTO audit_logs (log_id, book_id, actor_type, actor_id, operation_type,
         entity_type, entity_id, before_state, after_state, request_id)
     VALUES ($1,$2,'USER',$3,'CREATE','transactions',$4,NULL,$5::jsonb,$6)`,
    [
      auditId, ctx.bookId, ctx.userId, txnId,
      JSON.stringify({ transaction_id: txnId, transaction_type: cmd.transaction_type, amount_cents: cmd.amount_cents }),
      idempotencyKey,
    ],
  );

  // ---- outbox ----
  await client.query(
    `INSERT INTO outbox_events (event_id, book_id, aggregate_type, aggregate_id, event_type, payload)
     VALUES ($1,$2,'transactions',$4,'transaction.created',$3::jsonb)`,
    [outboxId, ctx.bookId, JSON.stringify({ transaction_id: txnId }), txnId],
  );

  return { transaction_id: txnId, replayed: false };
}

// ---------------------------------------------------------------------------
// void (reversal) — ADR-204
// ---------------------------------------------------------------------------

export async function voidTransaction(
  client: PoolClient,
  ctx: { bookId: string; userId: string },
  transactionId: string,
  reversalDate: string,
  reason: string | null,
  idempotencyKey: string,
): Promise<CommandResult> {
  const loaded = await client.query(
    `SELECT transaction_id::text, transaction_type, amount_cents, status,
            voided_by_transaction_id::text, related_transaction_id::text,
            source_account_id::text, destination_account_id::text, credit_account_id::text,
            category_code, data_state, transaction_date::text
       FROM transactions WHERE transaction_id = $1::uuid`,
    [transactionId],
  );
  const orig = loaded.rows[0];
  if (!orig) {
    throw new ApiError({ status: 404, code: "NOT_FOUND", title: "Transaction not found" });
  }
  if (orig.related_transaction_id) {
    // this row IS a reversal (reversals reference their original)
    throw new ApiError({
      status: 422, code: "NOT_VOIDABLE",
      title: "A reversal transaction cannot be voided (B-21)",
    });
  }
  if (orig.voided_by_transaction_id) {
    throw new ApiError({
      status: 422, code: "ALREADY_VOIDED",
      title: "Transaction is already voided",
      detail: `voided by ${orig.voided_by_transaction_id}`,
    });
  }
  await assertPeriodOpen(client, reversalDate);

  // build the reversal: same legs, directions swapped
  const entries = await client.query(
    `SELECT direction, amount_cents::text, ledger_account_id::text, flow_effect,
            entry_role, expense_bucket
       FROM transaction_entries WHERE transaction_id = $1::uuid ORDER BY line_no`,
    [transactionId],
  );

  const reversalId = randomUUID();
  await client.query(
    `INSERT INTO transactions (transaction_id, book_id, transaction_type, amount_cents,
         transaction_date, posting_date, status, source_account_id, destination_account_id,
         credit_account_id, category_code, description, data_state, source_type,
         related_transaction_id, idempotency_key)
     VALUES ($1,$2,$3,$4,$5,$5,'POSTED',$6,$7,$8,$9,$10,$11,'MANUAL',$12,$13)`,
    [
      reversalId, ctx.bookId, orig.transaction_type, orig.amount_cents,
      reversalDate,
      orig.source_account_id, orig.destination_account_id, orig.credit_account_id,
      orig.category_code,
      `Reversal of ${transactionId}${reason ? `: ${reason}` : ""}`,
      orig.data_state, transactionId, idempotencyKey,
    ],
  );
  let line = 1;
  for (const e of entries.rows) {
    await client.query(
      `INSERT INTO transaction_entries (entry_id, transaction_id, line_no, direction,
           amount_cents, ledger_account_id, flow_effect, entry_role, expense_bucket)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        randomUUID(), reversalId, line++,
        e.direction === "DEBIT" ? "CREDIT" : "DEBIT", // swapped
        e.amount_cents, e.ledger_account_id, e.flow_effect, e.entry_role, e.expense_bucket,
      ],
    );
  }

  // original points at its reversal; stored status stays POSTED (ADR-204)
  await client.query(
    `UPDATE transactions SET voided_by_transaction_id = $2, updated_at = now()
      WHERE transaction_id = $1::uuid`,
    [transactionId, reversalId],
  );

  await client.query(
    `INSERT INTO audit_logs (log_id, book_id, actor_type, actor_id, operation_type,
         entity_type, entity_id, before_state, after_state, request_id)
     VALUES ($1,$2,'USER',$3,'CREATE','transactions',$4,NULL,$5::jsonb,$6)`,
    [
      randomUUID(), ctx.bookId, ctx.userId, reversalId,
      JSON.stringify({ reversal_of: transactionId, reason }),
      idempotencyKey,
    ],
  );
  await client.query(
    `INSERT INTO outbox_events (event_id, book_id, aggregate_type, aggregate_id, event_type, payload)
     VALUES ($1,$2,'transactions',$4,'transaction.voided',$3::jsonb)`,
    [randomUUID(), ctx.bookId, JSON.stringify({ transaction_id: transactionId, reversal_id: reversalId }), transactionId],
  );

  return { transaction_id: reversalId, replayed: false };
}
