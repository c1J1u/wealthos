import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const frontend = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.resolve(frontend, process.env.WEALTHOS_DIST ?? "dist");
const revision = fs.readdirSync(path.join(dist, "assets")).filter((file) => !file.endsWith(".map")).sort().join("|");
const targets = ["index.html", ...fs.readdirSync(path.join(dist, "assets")).filter((file) => !file.endsWith(".map")).map((file) => `assets/${file}`)];
const body = fs.readFileSync(path.join(frontend, "src/offline/sw.js"), "utf8").replace("__WEALTHOS_PRECACHE__", JSON.stringify(targets));
fs.writeFileSync(path.join(dist, "sw.js"), body.replace("__WEALTHOS_REVISION__", JSON.stringify(revision)));
fs.writeFileSync(path.join(dist, "offline-manifest.json"), `${JSON.stringify({ cache: "wealthos-static-v1", precache: targets, apiCaching: false }, null, 2)}\n`);
