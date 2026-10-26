// Loopback-only preview with API forwarding. No financial responses or
// credentials are stored by this process; API mode is chosen at build time.
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", process.env.WEALTHOS_DIST ?? "dist");
const port = Number(process.env.PORT ?? 5180);
const apiTarget = new URL(process.env.WEALTHOS_API_TARGET ?? "http://127.0.0.1:3100");
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".woff2": "font/woff2", ".txt": "text/plain; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png" };

const server = http.createServer((req, res) => {
  const requestUrl = new URL(req.url ?? "/", "http://127.0.0.1");
  if (requestUrl.pathname.startsWith("/v1/")) {
    const target = new URL(requestUrl.pathname + requestUrl.search, apiTarget);
    const proxy = http.request(target, { method: req.method, headers: { ...req.headers, host: apiTarget.host } }, (upstream) => {
      res.writeHead(upstream.statusCode ?? 502, upstream.headers);
      upstream.pipe(res);
    });
    proxy.on("error", () => {
      res.writeHead(503, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ type: "about:blank", title: "数据服务不可用", status: 503, code: "DATABASE_UNAVAILABLE", request_id: "preview-proxy" }));
    });
    req.pipe(proxy);
    return;
  }
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405).end();
    return;
  }
  const pathname = decodeURIComponent(requestUrl.pathname);
  const requested = path.resolve(root, `.${pathname === "/" ? "/index.html" : pathname}`);
  const file = requested.startsWith(`${root}${path.sep}`) && fs.existsSync(requested) && fs.statSync(requested).isFile() ? requested : path.join(root, "index.html");
  if (!fs.existsSync(file)) {
    res.writeHead(503, { "content-type": "text/plain; charset=utf-8" });
    res.end("请先执行 pnpm -C frontend build");
    return;
  }
  const headers = { "content-type": types[path.extname(file)] ?? "application/octet-stream" };
  if (file.endsWith("sw.js")) Object.assign(headers, { "cache-control": "no-cache, no-store, must-revalidate" });
  res.writeHead(200, headers);
  if (req.method === "HEAD") res.end();
  else fs.createReadStream(file).pipe(res);
});

server.on("error", (error) => {
  console.error(`Preview failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
server.listen(port, "127.0.0.1", () => console.log(`WealthOS preview http://127.0.0.1:${port} -> ${apiTarget.origin}`));
for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => server.close(() => process.exit(0)));
