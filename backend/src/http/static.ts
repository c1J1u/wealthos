/**
 * Static app hosting: serves one of the frontend build directories
 * (dist | dist-demo | dist-commands | dist-readonly) on the same origin
 * as /v1 — the packaged "本机服务" form from the architecture book §5.1.
 *
 * - enabled when WEALTHOS_STATIC_DIR points at an existing directory
 *   controlled by WEALTHOS_STATIC_DIR
 * - hash routing means / is the only real entry; a catch-all GET fallback
 *   to index.html keeps deep links and refreshes working anyway
 * - /v1, /health and unknown methods are never shadowed by the fallback
 */
import type { FastifyInstance } from "fastify";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import fastifyStatic from "@fastify/static";

export function registerStaticApp(app: FastifyInstance, staticDir: string | undefined): void {
  if (!staticDir) return;
  const dir = resolve(staticDir);
  if (!existsSync(dir)) {
    app.log.warn(`WEALTHOS_STATIC_DIR points at a missing directory: ${dir} — serving API only`);
    return;
  }
  app.log.info(`serving static app from ${dir}`);
  void app.register(fastifyStatic, {
    root: dir,
    prefix: "/",
    wildcard: false,
    // static assets are immutable content-hashed files
    maxAge: "1h",
  });

  // SPA fallback for GET routes that match no file (hash router needs "/",
  // but keep deep links robust). API routes are registered BEFORE this
  // handler, so they always win.
  app.setNotFoundHandler((req, reply) => {
    const pathname = req.url.split("?", 1)[0] ?? req.url;
    if (req.method !== "GET" || pathname.startsWith("/v1") || pathname.startsWith("/.") || pathname.split("/").some((part) => part === ".env" || part === ".ledger.json")) {
      reply.code(404).send({
        type: "about:blank",
        title: "Not found",
        status: 404,
        code: "NOT_FOUND",
        request_id: "static",
      });
      return;
    }
    return reply.sendFile("index.html");
  });
}
