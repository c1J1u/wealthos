/**
 * Session & auth (M2).
 *
 * Two modes (WEALTHOS_AUTH env, default "local"):
 *
 *   local   — v1 loopback behavior, unchanged: session auto-issued and
 *             bound to the fixture persona book (demo databases).
 *
 *   pairing — required before ANY remote exposure. First contact gets 401
 *             PAIRING_REQUIRED; a one-time 8-digit code is printed in the
 *             server console; POST /v1/auth/pair {code} exchanges it for a
 *             DB-backed session (sessions table, sha256 token hash, 12h
 *             expiry, csrf token). All POSTs then require the
 *             X-CSRF-Token header — double insurance on top of the Origin
 *             check + SameSite=Strict cookie.
 *
 *             The book/user binding comes from backend/.ledger.json,
 *             written by bootstrap-ledger.ts (the bootstrapped REAL
 *             ledger); pairing mode without that file refuses to start.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import type { Pool } from "pg";
import { fixtureId } from "../scripts/fixture-ids.js";

/** Real-ledger binding, read by the caller (app.ts) from .ledger.json. */
export interface LedgerBinding {
  user_id: string;
  book_id: string;
}

/** Read backend/.ledger.json (bootstrap output); absent on demo targets. */
export function readLedgerBinding(root: string): LedgerBinding | null {
  const p = resolve(root, ".ledger.json");
  if (!existsSync(p)) return null;
  try {
    const raw = JSON.parse(readFileSync(p, "utf8")) as Partial<LedgerBinding>;
    if (raw.user_id && raw.book_id) return { user_id: raw.user_id, book_id: raw.book_id };
  } catch {
    /* fallthrough */
  }
  return null;
}

export const SESSION_COOKIE = "wealthos_session";
export const CSRF_HEADER = "x-csrf-token";

export type AuthMode = "local" | "pairing";

export interface SessionContext {
  userId: string;
  bookId: string;
  persona: string;
}

const hash = (token: string) => createHash("sha256").update(token).digest("hex");

export function decorateSession(
  app: FastifyInstance,
  persona: string | undefined,
  mode: AuthMode,
  pool: Pool,
  binding: LedgerBinding | null,
  injectedPairingCode?: string,
): void {
  const localCtx: SessionContext | null = persona ? {
    persona,
    userId: fixtureId(persona, "user", persona),
    bookId: fixtureId(persona, "book", persona),
  } : null;

  let pairingCtx: SessionContext | null = null;
  let pendingCode: string | null = null;
  let pendingCodeExpires = 0;

  // The real-ledger binding takes precedence in BOTH modes when present;
  // demo targets simply have none (the caller found no .ledger.json).
  if (binding && !localCtx) {
    pairingCtx = { persona: "owner", userId: binding.user_id, bookId: binding.book_id };
  }

  if (!binding && !localCtx) {
    throw new Error("No ledger binding. Run `pnpm -C backend bootstrap` before starting WealthOS.");
  }

  if (mode === "pairing") {
    if (!binding) {
      throw new Error(
        "WEALTHOS_AUTH=pairing requires backend/.ledger.json — run `pnpm -C backend bootstrap` first",
      );
    }
    app.log.info("auth: pairing mode (real ledger binding from .ledger.json)");
  }

  const issuePairingCode = (): void => {
    pendingCode = injectedPairingCode ?? String(Math.floor(10_000_000 + Math.random() * 90_000_000));
    pendingCodeExpires = Date.now() + 5 * 60_000;
    console.log("\n======== WealthOS pairing code ========");
    if (process.env.NODE_ENV !== "test") console.log(`  ${pendingCode}`);
    console.log("  Enter in the browser; single use, expires in five minutes.");
    console.log("=======================================\n");
  };

  app.addHook("onRequest", async (req: FastifyRequest, reply: FastifyReply) => {
    // same-origin/loopback guard — both modes
    const origin = req.headers.origin;
    if (origin) {
      const host = req.headers.host ?? "";
      try {
        const o = new URL(origin);
        if (o.host !== host) {
          reply.code(403).send({ title: "Cross-origin rejected", status: 403, code: "CROSS_ORIGIN", request_id: "n/a" });
          return;
        }
      } catch {
        reply.code(403).send({ title: "Bad origin", status: 403, code: "CROSS_ORIGIN", request_id: "n/a" });
        return;
      }
    }

    if (mode === "local") {
      // An explicit demo session takes precedence; owner mode uses its binding.
      const ctx = (pairingCtx ?? localCtx)!;
      if (!req.cookies[SESSION_COOKIE]) {
        reply.setCookie(SESSION_COOKIE, hash(`${ctx.bookId}:local`), {
          httpOnly: true, sameSite: "strict", path: "/",
        });
      }
      req.session = ctx;
      return;
    }

    // ---- pairing mode ----
    const ctx = pairingCtx!;
    // Public surface first: the static app, SPA fallback and system
    // endpoints must load BEFORE a session exists — the pairing UI itself
    // is part of that app. Only /v1/* carries the session/CSRF gate.
    const openApiPaths = ["/v1/health", "/v1/meta", "/v1/auth/pair"];
    if (!req.url.startsWith("/v1")) {
      req.session = ctx; // provisional; static serving never uses it
      return;
    }
    if (openApiPaths.includes(req.url)) {
      req.session = ctx;
      return;
    }
    const token = req.cookies[SESSION_COOKIE];
    if (!token) {
      if (!pendingCode && !injectedPairingCode) issuePairingCode();
      reply.code(401).send({
        title: "Pairing required",
        status: 401,
        code: "PAIRING_REQUIRED",
        detail: "POST /v1/auth/pair with the code printed in the server console",
        request_id: "n/a",
      });
      return;
    }
    const session = await pool.query(
      `SELECT csrf_token FROM sessions
        WHERE token_hash = $1 AND expires_at > now() AND revoked_at IS NULL`,
      [hash(token)],
    );
    if (session.rows.length === 0) {
      if (!pendingCode && !injectedPairingCode) issuePairingCode();
      reply.code(401).send({
        title: "Session expired or invalid",
        status: 401,
        code: "SESSION_INVALID",
        detail: "pair again via POST /v1/auth/pair",
        request_id: "n/a",
      });
      return;
    }
    req.session = ctx;

    // CSRF double insurance on mutating verbs inside /v1 (the pair
    // endpoint itself is the bootstrap and is exempt)
    if (req.method === "POST" && req.url !== "/v1/auth/pair") {
      const sent = req.headers[CSRF_HEADER];
      const expected = session.rows[0].csrf_token as string | null;
      if (!expected || sent !== expected) {
        reply.code(403).send({
          title: "CSRF token missing or wrong",
          status: 403,
          code: "CSRF_REQUIRED",
          detail: `send header ${CSRF_HEADER} with the value from the pairing response`,
          request_id: "n/a",
        });
        return;
      }
    }
  });

  if (mode === "pairing") {
    app.post("/v1/auth/pair", async (req, reply) => {
      if (!pendingCode || Date.now() > pendingCodeExpires) {
        issuePairingCode();
        reply.code(401).send({
          title: "Code expired; a new one was printed in the server console",
          status: 401, code: "PAIRING_EXPIRED", request_id: "n/a",
        });
        return;
      }
      const body = req.body as { code?: string } | null;
      if (!body?.code || body.code !== pendingCode) {
        reply.code(401).send({
          title: "Wrong pairing code", status: 401, code: "PAIRING_WRONG", request_id: "n/a",
        });
        return;
      }
      const token = randomBytes(32).toString("hex");
      const csrfToken = randomUUID();
      await pool.query(
        `INSERT INTO sessions (session_id, user_id, token_hash, expires_at, csrf_token)
         VALUES ($1, $2, $3, now() + interval '12 hours', $4)`,
        [randomUUID(), pairingCtx!.userId, hash(token), csrfToken],
      );
      pendingCode = null; // one-time
      reply.setCookie(SESSION_COOKIE, token, {
        httpOnly: true, sameSite: "strict", path: "/",
      });
      reply.code(200).send({
        data: { paired: true, csrf_token: csrfToken, expires_in: "12h" },
        meta: { request_id: randomUUID() },
      });
    });
  }
}

declare module "fastify" {
  interface FastifyRequest {
    session: SessionContext;
  }
}
