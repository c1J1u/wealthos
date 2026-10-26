/** Identity routes: /me, /books. */
import type { FastifyInstance } from "fastify";
import { ok } from "../../http/envelope.js";
import { withBookTx } from "../../http/db.js";

export function registerIdentityRoutes(app: FastifyInstance): void {
  app.get("/v1/me", async (req) => {
    return withBookTx(app, req, async (client) => {
      const r = await client.query<{
        user_id: string; display_name: string; book_id: string; book_name: string;
      }>(
        `SELECT u.user_id::text, u.display_name,
                b.book_id::text, b.name AS book_name
           FROM users u
           JOIN memberships m ON m.user_id = u.user_id
           JOIN ledger_books b ON b.book_id = m.book_id
          WHERE u.user_id = $1::uuid AND b.book_id = $2::uuid`,
        [req.session.userId, req.session.bookId],
      );
      const row = r.rows[0];
      if (!row) return ok(null);
      return ok({
        user_id: row.user_id,
        display_name: row.display_name,
        book_id: row.book_id,
        book_name: row.book_name,
        roles: ["owner"],
        scopes: ["ledger.read", "metrics.read", "reports.read"],
      });
    });
  });

  app.get("/v1/books", async (req) => {
    return withBookTx(app, req, async (client) => {
      const r = await client.query(
        `SELECT b.book_id::text, b.name, b.base_currency, b.fiscal_start_month, b.status
           FROM ledger_books b
           JOIN memberships m ON m.book_id = b.book_id
          WHERE m.user_id = $1::uuid`,
        [req.session.userId],
      );
      return ok(r.rows, { data_state: "ACTUAL", partial: false, missing_count: 0 });
    });
  });
}
