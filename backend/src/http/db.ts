/**
 * Database access discipline:
 *  - one pg Pool per app (app role, non-owner -> RLS enforced)
 *  - every request runs inside a READ ONLY transaction with the book
 *    context set transaction-locally (set_config ... true)
 *  - /bootstrap uses REPEATABLE READ for a single consistent snapshot
 *    (architecture §3.4)
 */
import { Pool, type PoolClient } from "pg";
import type { FastifyInstance } from "fastify";
import { errors } from "./envelope.js";

declare module "fastify" {
  interface FastifyInstance {
    db: Pool;
  }
}

export function decorateDb(app: FastifyInstance, pool: Pool): void {
  app.decorate("db", pool);
}

/** Run `fn` inside a read-only transaction scoped to the book. */
export async function withBookTx<T>(
  app: FastifyInstance,
  req: { session: { bookId: string } },
  fn: (client: PoolClient) => Promise<T>,
  opts: { repeatableRead?: boolean } = {},
): Promise<T> {
  return runTx(app, req, fn, {
    isolation: opts.repeatableRead ? "REPEATABLE READ READ ONLY" : "READ ONLY",
  });
}

/** Run `fn` inside a read-write transaction scoped to the book (P2 writes). */
export async function withBookWriteTx<T>(
  app: FastifyInstance,
  req: { session: { bookId: string } },
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  return runTx(app, req, fn, { isolation: "READ WRITE" });
}

async function runTx<T>(
  app: FastifyInstance,
  req: { session: { bookId: string } },
  fn: (client: PoolClient) => Promise<T>,
  opts: { isolation: string },
): Promise<T> {
  const client = await app.db.connect().catch(() => {
    throw errors.unavailable();
  });
  try {
    await client.query(`BEGIN ${opts.isolation}`);
    await client.query("SELECT set_config('app.book_id', $1, true)", [req.session.bookId]);
    const out = await fn(client);
    await client.query("COMMIT");
    return out;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
