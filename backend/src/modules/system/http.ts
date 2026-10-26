/** System routes: /meta (server time, capabilities). /health lives in app.ts. */
import type { FastifyInstance } from "fastify";
import type { AppConfig } from "../../config/config.js";
import { ok } from "../../http/envelope.js";
import { withBookTx } from "../../http/db.js";
import { APP_VERSION } from "../../app.js";

export function registerSystemRoutes(app: FastifyInstance, _config: AppConfig): void {
  app.get("/v1/meta", async (req) => {
    const info = await withBookTx(app, req, async (client) => {
      const r = await client.query<{ now: Date; tz: string; schema_id: number }>(
        `SELECT now() AS now,
                current_setting('TimeZone') AS tz,
                COALESCE((SELECT max(id) FROM schema_migrations), 0) AS schema_id`,
      );
      const row = r.rows[0]!;
      const now = row.now;
      const ymd = (d: Date) =>
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      // book_period (U-2): latest month with posted transactions
      const { defaultPeriod } = await import("../analytics/period.js");
      const bookPeriod = await defaultPeriod(client, req.session.bookId);
      return {
        server_time: now.toISOString().replace("Z", "+08:00"),
        timezone: row.tz,
        today: ymd(now),
        current_period: ymd(now).slice(0, 7),
        book_period: bookPeriod,
        schema_version: `migration-${row.schema_id}`,
      };
    });
    return ok({
      ...info,
      base_currency: "CNY",
      min_client_version: "0.1.0",
      capabilities: ["ledger.read", "metrics.read", "reports.read", "transactions.preview"],
      server_version: APP_VERSION,
    });
  });
}
