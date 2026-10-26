/**
 * POST /v1/transactions/preview — side-effect-free entry vector preview.
 * Conforms to TransactionPreviewRequest / TransactionPreview exactly:
 * resolves ledger accounts against the real book, proves debit=credit,
 * and returns full TransactionEntry rows with placeholder ids (nothing is
 * persisted, so entry_id/transaction_id are deterministic placeholders).
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { createHash, randomUUID } from "node:crypto";
import { ok, ApiError } from "../../http/envelope.js";
import { withBookTx } from "../../http/db.js";
import { buildEntries, SplitMismatchError } from "./entry-templates.js";

const PREVIEW_ALLOWED_FIELDS = new Set([
  "transaction_type", "amount_cents", "currency", "transaction_date",
  "posting_date", "source_account_id", "destination_account_id",
  "credit_account_id", "category_code", "merchant_name", "description",
  "expense_meta", "repayment_meta", "cost_basis_cents", "gain_cents",
]);

export function registerPreviewRoute(app: FastifyInstance): void {
  app.post("/v1/transactions/preview", async (req) => {
    const body = req.body as Record<string, unknown>;
    // mirror the contract's additionalProperties: false
    const offenders = Object.keys(body ?? {}).filter((k) => !PREVIEW_ALLOWED_FIELDS.has(k));
    if (offenders.length > 0) {
      throw new ApiError({
        status: 400, code: "VALIDATION_FAILED",
        title: "Unknown field in preview request",
        detail: `unsupported: ${offenders.join(", ")}`,
      });
    }
    const b = body as {
      transaction_type?: string;
      amount_cents?: number;
      currency?: string;
      transaction_date?: string;
      source_account_id?: string | null;
      destination_account_id?: string | null;
      credit_account_id?: string | null;
      category_code?: string | null;
      expense_meta?: { necessity_level?: string } | null;
      repayment_meta?: { principal_cents: number; interest_cents: number; fees_cents: number } | null;
    };
    if (!b.transaction_type || !b.amount_cents || !b.transaction_date) {
      throw new ApiError({
        status: 400, code: "VALIDATION_FAILED",
        title: "transaction_type, amount_cents and transaction_date are required",
      });
    }
    if (!Number.isInteger(b.amount_cents) || b.amount_cents <= 0 || b.amount_cents > 100_000_000_000) {
      throw new ApiError({
        status: 400, code: "VALIDATION_FAILED",
        title: "amount_cents must be a positive integer of at most 1e11 (FI-15)",
      });
    }

    return withBookTx(app, req, async (client) => {
      let specs;
      try {
        specs = buildEntries({
          transaction_id: "preview",
          transaction_type: b.transaction_type!,
          amount_cents: b.amount_cents!,
          source_account_id: b.source_account_id ?? null,
          destination_account_id: b.destination_account_id ?? null,
          credit_account_id: b.credit_account_id ?? null,
          category_id: b.category_code ?? null,
          repayment_meta: b.repayment_meta ?? null,
          expense_meta: b.expense_meta ?? null,
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
          title: "Request cannot produce a valid entry vector",
          detail: err instanceof Error ? err.message : String(err),
        });
      }

      // resolve every ledger account against the real book (404 on miss)
      const seed = createHash("sha256").update(JSON.stringify(body)).digest("hex");
      const placeholderTxnId = [
        seed.slice(0, 8), seed.slice(8, 12), seed.slice(12, 16),
        seed.slice(16, 20), seed.slice(20, 32),
      ].join("-");

      const warnings: string[] = [];
      const entries = [];
      let debitTotal = 0n;
      let creditTotal = 0n;
      for (const s of specs) {
        const resolved = await resolveAccount(client, s.ledgerAccountKey);
        if (resolved === null) {
          throw new ApiError({
            status: 404, code: "LEDGER_ACCOUNT_NOT_FOUND",
            title: "Ledger account not found in this book",
            detail: s.ledgerAccountKey,
          });
        }
        if (s.direction === "DEBIT") debitTotal += s.amount_cents;
        else creditTotal += s.amount_cents;
        entries.push({
          entry_id: placeholderId(seed, s.line_no),
          transaction_id: placeholderTxnId,
          line_no: s.line_no,
          direction: s.direction,
          amount_cents: Number(s.amount_cents),
          ledger_account_id: resolved.ledger_account_id,
          ledger_account_code: resolved.code,
          account_id: resolved.account_id,
          flow_effect: s.flow_effect,
          entry_role: s.entry_role,
          expense_bucket: s.expense_bucket,
          principal_cents: null,
          gain_cents: null,
          memo: null,
          currency: "CNY",
          base_amount_cents: Number(s.amount_cents),
        });
      }
      if (specs.length < 6) {
        warnings.push("zero-amount legs are omitted; a full six-leg repayment has 6 entries when P/I/F are all non-zero");
      }

      const balanced = debitTotal === creditTotal && debitTotal === BigInt(b.amount_cents!);
      return ok({
        transaction_type: b.transaction_type,
        amount_cents: b.amount_cents,
        balanced,
        debit_total_cents: Number(debitTotal),
        credit_total_cents: Number(creditTotal),
        entries,
        warnings,
      });
    });
  });
}

interface Resolved {
  ledger_account_id: string;
  code: string;
  account_id: string | null;
}

async function resolveAccount(client: import("pg").PoolClient, key: string): Promise<Resolved | null> {
  if (key.startsWith("acct:")) {
    const r = await client.query(
      `SELECT ledger_account_id::text, code, account_id::text
         FROM ledger_accounts WHERE account_id = $1::uuid`,
      [key.slice(5)],
    );
    return r.rows[0] ?? null;
  }
  if (key.startsWith("cat:")) {
    const r = await client.query(
      `SELECT ledger_account_id::text, code, account_id::text
         FROM ledger_accounts WHERE category_code = $1`,
      [key.slice(4)],
    );
    return r.rows[0] ?? null;
  }
  return null;
}

function placeholderId(seed: string, line: number): string {
  const h = createHash("sha256").update(`${seed}:${line}`).digest("hex");
  return [h.slice(0, 8), h.slice(8, 12), h.slice(12, 16), h.slice(16, 20), h.slice(20, 32)].join("-");
}
