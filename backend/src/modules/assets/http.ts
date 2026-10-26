/** Assets & investment read routes (contract: Asset/Position/Portfolio). */
import type { FastifyInstance } from "fastify";
import { ok, errors } from "../../http/envelope.js";
import { withBookTx } from "../../http/db.js";
import { assertQuery, parseDate } from "../../http/query.js";
import { positionsAsOf } from "../analytics/balances.js";

export function registerAssetsRoutes(app: FastifyInstance): void {
  app.get("/v1/assets", async (req) => {
    assertQuery(req, ["as_of"]);
    const asOf = parseDate(req, "as_of") ?? new Date().toISOString().slice(0, 10);
    return withBookTx(app, req, async (client) => {
      // Non-account assets with their latest valuation <= asOf.
      const r = await client.query(
        `SELECT a.asset_id::text, a.name, a.asset_type, a.account_id::text,
                a.currency, a.data_state, a.version,
                latest.market_value_cents::text AS latest_market_value_cents,
                latest.valuation_date::text AS valuation_date,
                acc.liquidity_level
           FROM assets a
           LEFT JOIN accounts acc ON acc.account_id = a.account_id
           LEFT JOIN LATERAL (
             SELECT market_value_cents, as_of::text AS valuation_date FROM asset_valuations av
              WHERE av.asset_id = a.asset_id AND av.as_of <= $2::date
              ORDER BY av.as_of DESC LIMIT 1
           ) latest ON true
          WHERE a.book_id = $1::uuid
          ORDER BY a.name`,
        [req.session.bookId, asOf],
      );
      return ok(r.rows.map((x: any) => ({
        ...x,
        latest_market_value_cents:
          x.latest_market_value_cents === null ? null : Number(x.latest_market_value_cents),
      })), { as_of: asOf });
    });
  });

  app.get("/v1/assets/:id/valuations", async (req) => {
    const { id } = req.params as { id: string };
    return withBookTx(app, req, async (client) => {
      const a = await client.query(`SELECT 1 FROM assets WHERE asset_id = $1::uuid`, [id]);
      if (a.rows.length === 0) throw errors.notFound("Asset");
      const r = await client.query(
        `SELECT valuation_id::text AS asset_valuation_id, as_of::text AS valuation_date,
                market_value_cents::text, currency, data_state
           FROM asset_valuations WHERE asset_id = $1::uuid
          ORDER BY as_of DESC`,
        [id],
      );
      return ok(r.rows.map((x: any) => ({
        ...x, market_value_cents: Number(x.market_value_cents),
      })));
    });
  });

  app.get("/v1/instruments", async (req) => {
    return withBookTx(app, req, async (client) => {
      const r = await client.query(
        `SELECT instrument_id::text, ticker, name, asset_class, currency
           FROM instruments ORDER BY ticker`,
      );
      return ok(r.rows);
    });
  });

  app.get("/v1/positions", async (req) => {
    assertQuery(req, ["as_of"]);
    const asOf = parseDate(req, "as_of") ?? new Date().toISOString().slice(0, 10);
    return withBookTx(app, req, async (client) => {
      const rows = await positionsAsOf(client, req.session.bookId, asOf);
      return ok(rows.map((p) => ({
        position_id: p.position_id,
        instrument_id: p.instrument_id,
        account_id: p.account_id,
        ticker: p.ticker,
        instrument_name: p.instrument_name,
        asset_class: p.asset_class,
        quantity: Number(p.quantity),
        average_cost_cents: Number(p.average_cost_cents),
        total_cost_basis_cents: Number(p.total_cost_basis_cents),
        realized_pnl_cents: Number(p.realized_pnl_cents),
        latest_price_cents: p.latest_price_cents === null ? null : Number(p.latest_price_cents),
        latest_price_as_of: p.latest_price_as_of,
        latest_price_source: p.latest_price_source,
        market_value_cents: p.market_value_cents === null ? null : Number(p.market_value_cents),
        na_reason: p.market_value_cents === null ? "NO_MARKET_PRICE" : null,
      })), { as_of: asOf });
    });
  });

  app.get("/v1/portfolio", async (req) => {
    assertQuery(req, ["as_of"]);
    const asOf = parseDate(req, "as_of") ?? new Date().toISOString().slice(0, 10);
    return withBookTx(app, req, async (client) => {
      const rows = await positionsAsOf(client, req.session.bookId, asOf);
      let marketValue = 0n;
      let costBasis = 0n;
      let realized = 0n;
      const valued = [];
      for (const p of rows) {
        realized += p.realized_pnl_cents;
        if (p.market_value_cents === null) continue; // unpriced: excluded, not zero
        marketValue += p.market_value_cents;
        costBasis += p.total_cost_basis_cents;
        valued.push({
          position_id: p.position_id,
          instrument_id: p.instrument_id,
          account_id: p.account_id,
          ticker: p.ticker,
          instrument_name: p.instrument_name,
          asset_class: p.asset_class,
          quantity: Number(p.quantity),
          average_cost_cents: Number(p.average_cost_cents),
          total_cost_basis_cents: Number(p.total_cost_basis_cents),
          realized_pnl_cents: Number(p.realized_pnl_cents),
          latest_price_cents: p.latest_price_cents === null ? null : Number(p.latest_price_cents),
          latest_price_as_of: p.latest_price_as_of,
          latest_price_source: p.latest_price_source,
          market_value_cents: p.market_value_cents === null ? null : Number(p.market_value_cents),
          na_reason: p.market_value_cents === null ? "NO_MARKET_PRICE" : null,
        });
      }
      return ok({
        as_of: asOf,
        market_value_cents: Number(marketValue),
        cost_basis_cents: Number(costBasis),
        unrealized_pnl_cents: Number(marketValue - costBasis),
        realized_pnl_cents: Number(realized),
        positions: valued,
      }, { as_of: asOf });
    });
  });
}
