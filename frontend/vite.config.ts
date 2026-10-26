import { defineConfig } from "vite";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const frontendRoot = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  build: {
    target: "es2022",
    sourcemap: true,
    outDir: path.resolve(frontendRoot, process.env.WEALTHOS_DIST ?? "dist"),
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    proxy: {
      "/v1": {
        // Set WEALTHOS_API_TARGET=http://127.0.0.1:8787 for the real backend.
        target: process.env.WEALTHOS_API_TARGET ?? "http://127.0.0.1:3100",
        changeOrigin: false,
      },
    },
  },
  preview: { host: "127.0.0.1", port: 5173 },
  plugins: [{
    name: "wealthos-offline-manifest",
    configurePreviewServer(server) {
      server.middlewares.use((request, response, next) => {
        if (request.url === "/sw.js") response.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
        next();
      });
    },
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (request.url !== "/sw.js") return next();
        // Development has no build manifest; unregister any stale worker
        // rather than serving the SPA fallback as JavaScript.
        response.setHeader("Content-Type", "application/javascript; charset=utf-8");
        response.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
        response.end(`self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(Promise.all([
  self.clients.claim(),
  self.registration.unregister(),
  caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith("wealthos-static-")).map((key) => caches.delete(key)))),
])));`);
      });
    },
    async closeBundle() {
      // Run after Vite writes the production bundle; no API data is included.
      await import("./scripts/offline-manifest.mjs");
      const licenses = path.resolve(frontendRoot, process.env.WEALTHOS_DIST ?? "dist", "licenses");
      fs.mkdirSync(licenses, { recursive: true });
      for (const font of ["geist", "geist-mono"]) {
        fs.copyFileSync(path.join(frontendRoot, "node_modules", `@fontsource-variable/${font}/LICENSE`), path.join(licenses, `${font}-OFL.txt`));
      }
    },
  }],
});
