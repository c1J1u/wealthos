/** Entry: load config, build app, listen on loopback, graceful shutdown. */
import { buildApp } from "./app.js";
import { loadConfig } from "./config/config.js";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const config = loadConfig(undefined, root);
const app = buildApp({
  config,
  ...(process.env.WEALTHOS_STATIC_DIR ? { staticDir: process.env.WEALTHOS_STATIC_DIR } : {}),
  ...(process.env.WEALTHOS_AUTH === "pairing" ? { authMode: "pairing" as const } : {}),
  root,
});

async function main() {
  const { host, port } = config.server;
  await app.listen({ host, port });
  app.log.info(`WealthOS backend listening on http://${host}:${port} (profile=${config.database.profile})`);
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    app.log.info(`${signal} received, shutting down`);
    app.close().then(() => process.exit(0)).catch((err) => {
      app.log.error(err);
      process.exit(1);
    });
  });
}

main().catch((err) => {
  app.log.error(err);
  process.exit(1);
});
