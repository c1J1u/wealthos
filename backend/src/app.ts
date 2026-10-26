/**
 * Fastify application factory. All routes are the P1 read-only contract
 * surface (28 GET + 1 stateless POST preview) under /v1.
 */
import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import { Pool } from "pg";
import type { AppConfig } from "./config/config.js";
import { decorateDb } from "./http/db.js";
import { decorateSession, readLedgerBinding, type LedgerBinding } from "./http/session.js";
import { ApiError, problemReply } from "./http/envelope.js";
import { registerSystemRoutes } from "./modules/system/http.js";
import { registerIdentityRoutes } from "./modules/identity/http.js";
import { registerLedgerRoutes } from "./modules/ledger/http.js";
import { registerAssetsRoutes } from "./modules/assets/http.js";
import { registerAnalyticsRoutes } from "./modules/analytics/http.js";
import { registerGovernanceRoutes } from "./modules/governance/http.js";
import { registerViewsRoutes } from "./modules/views/http.js";
import { registerStaticApp } from "./http/static.js";

export interface AppOptions {
  config: AppConfig;
  demoPersona?: string;
  /** frontend build directory to host (undefined = API-only dev mode) */
  staticDir?: string;
  /** "local" (default, auto session) | "pairing" (M2 hardening) */
  authMode?: "local" | "pairing";
  /** real-ledger binding override; when absent and root is set, read from root/.ledger.json */
  ledgerBinding?: LedgerBinding;
  /** backend root to read .ledger.json from (server entry passes this) */
  root?: string;
  /** test-only pairing code injection; production uses a random one-time code */
  pairingCode?: string;
}

export function buildApp(opts: AppOptions): FastifyInstance {
  const { config } = opts;
  const app = Fastify({
    logger: {
      level: config.server.logLevel,
      redact: ["req.headers.cookie", "req.headers.authorization"],
    },
  });

  const pool = new Pool({
    host: config.database.host,
    port: config.database.port,
    database: config.database.name,
    user: config.database.user,
    password: config.database.password,
    max: 5,
    idleTimeoutMillis: 30_000,
  });
  pool.on("error", (err) => app.log.error(err, "idle pool error"));

  const demoPersona = opts.demoPersona ?? process.env.WEALTHOS_DEMO_PERSONA;
  if (demoPersona && !["wealthos_demo", "wealthos_test"].includes(config.database.name)) {
    throw new Error("A demo persona requires the dedicated wealthos_demo or wealthos_test database.");
  }

  app.register(cookie);
  decorateDb(app, pool);
  const authMode: "local" | "pairing" =
    (opts.authMode ?? process.env.WEALTHOS_AUTH ?? "local") === "pairing" ? "pairing" : "local";
  const ledgerBinding: LedgerBinding | null =
    opts.ledgerBinding ?? (opts.demoPersona ? null : (opts.root ? readLedgerBinding(opts.root) : null));
  decorateSession(
    app,
    demoPersona,
    authMode,
    pool,
    ledgerBinding,
    opts.pairingCode,
  );

  app.setErrorHandler((err: Error & { validation?: unknown }, req, reply) => {
    if (err instanceof ApiError) {
      problemReply(req, reply, err.init);
      return;
    }
    if (err.validation) {
      problemReply(req, reply, {
        status: 400,
        code: "VALIDATION_FAILED",
        title: "Request validation failed",
        detail: err.message,
      });
      return;
    }
    req.log.error(err);
    problemReply(req, reply, {
      status: 500,
      code: "INTERNAL",
      title: "Internal server error",
    });
  });

  app.get("/health", async () => healthBody(pool));
  app.get("/v1/health", async () => healthBody(pool));

  registerSystemRoutes(app, config);
  registerIdentityRoutes(app);
  registerLedgerRoutes(app);
  registerAssetsRoutes(app);
  registerAnalyticsRoutes(app);
  registerGovernanceRoutes(app);
  registerViewsRoutes(app);
  // static app hosting is last: API routes always take precedence
  registerStaticApp(app, opts.staticDir);

  app.addHook("onClose", async () => {
    await pool.end();
  });

  return app;
}

export const APP_VERSION = "0.1.0";

async function healthBody(pool: Pool): Promise<{ status: string; version: string; db: "up" | "down" }> {
  let db: "up" | "down" = "down";
  try {
    const c = await pool.connect();
    try {
      await c.query("SELECT 1");
      db = "up";
    } finally {
      c.release();
    }
  } catch {
    /* db down still reports a alive service */
  }
  return { status: "ok", version: APP_VERSION, db };
}
