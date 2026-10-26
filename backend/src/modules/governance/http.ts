/** Governance read routes: /data-quality (contract DataQualityReport), /audit-logs. */
import type { FastifyInstance } from "fastify";
import { ok } from "../../http/envelope.js";
import { withBookTx } from "../../http/db.js";
import { assertQuery, parseLimit } from "../../http/query.js";

export function registerGovernanceRoutes(app: FastifyInstance): void {
  app.get("/v1/data-quality", async (req) => {
    assertQuery(req, []);
    return withBookTx(app, req, async (client) => {
      const bookId = req.session.bookId;
      const unbalanced = await client.query<{ c: string }>(
        `SELECT count(*)::text AS c FROM v_unbalanced_transactions WHERE book_id = $1::uuid`,
        [bookId],
      );
      const negative = await client.query(
        `SELECT a.account_id::text, a.name, v.balance_cents::text
           FROM v_account_balances_computed v
           JOIN accounts a ON a.account_id = v.account_id
          WHERE a.book_id = $1::uuid
            AND a.normal_side = 'ASSET' AND v.balance_cents < 0`,
        [bookId],
      );
      const estimates = await client.query<{ c: string }>(
        `SELECT count(*)::text AS c FROM transactions
          WHERE book_id = $1::uuid AND data_state = 'ESTIMATE'`,
        [bookId],
      );
      const unpriced = await client.query<{ c: string }>(
        `SELECT count(*)::text AS c FROM positions p
          WHERE p.book_id = $1::uuid
            AND NOT EXISTS (
              SELECT 1 FROM market_prices m WHERE m.instrument_id = p.instrument_id)`,
        [bookId],
      );
      const synthetic = await client.query<{ c: string }>(
        `SELECT count(*)::text AS c FROM accounts
          WHERE book_id = $1::uuid AND name LIKE '%（合成）%'`,
        [bookId],
      );

      const unbalancedOk = unbalanced.rows[0]!.c === "0";
      const negativeOk = negative.rows.length === 0;
      const unpricedOk = unpriced.rows[0]!.c === "0";
      const checks = [
        {
          check_id: "unbalanced_transactions",
          pass: unbalancedOk,
          detail: unbalancedOk ? "all posted transactions balance" : `count=${unbalanced.rows[0]!.c}`,
        },
        {
          check_id: "negative_asset_balances",
          pass: negativeOk,
          detail: negativeOk
            ? "no asset account has a negative balance"
            : negative.rows.map((r: any) => `${r.name}=${r.balance_cents}`).join(", "),
        },
        {
          check_id: "estimate_transactions",
          pass: true,
          detail: `count=${estimates.rows[0]!.c} (demo openings are ESTIMATE by design)`,
        },
        {
          check_id: "positions_without_price",
          pass: unpricedOk,
          detail: unpricedOk ? "all positions have a market price" : `count=${unpriced.rows[0]!.c}`,
        },
        {
          check_id: "synthetic_accounts_present",
          pass: true,
          detail: `count=${synthetic.rows[0]!.c} (fixture normalization artifacts, documented)`,
        },
      ];
      // Ruling B-11: only FAIL (not WARN) breaks overall pass; every check
      // above is pass/fail, so overall = AND of all.
      return ok({
        run_at: new Date().toISOString(),
        pass: checks.every((c) => c.pass),
        checks,
        fixture_normalization: {
          source: "backend/fixtures (N-01..N-12)",
          estimate_transactions: Number(estimates.rows[0]!.c),
          synthetic_accounts: Number(synthetic.rows[0]!.c),
        },
      });
    });
  });

  app.get("/v1/audit-logs", async (req) => {
    assertQuery(req, ["limit", "cursor"]);
    const limit = parseLimit(req);
    return withBookTx(app, req, async (client) => {
      const r = await client.query(
        `SELECT log_id::text, actor_type, actor_id, operation_type,
                entity_type, entity_id, request_id, created_at
           FROM audit_logs
          ORDER BY created_at DESC
          LIMIT ${limit + 1}`,
      );
      const hasMore = r.rows.length > limit;
      return ok(r.rows.slice(0, limit), {
        next_cursor: hasMore ? r.rows[limit - 1]!.log_id : null,
      });
    });
  });
}
