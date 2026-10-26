import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const frontend = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.resolve(frontend, process.env.WEALTHOS_DIST ?? "dist");
const manifest = JSON.parse(fs.readFileSync(path.join(dist, "offline-manifest.json"), "utf8"));
const cssFiles = fs.readdirSync(path.join(dist, "assets")).filter((file) => file.endsWith(".css"));
const css = cssFiles.map((file) => fs.readFileSync(path.join(dist, "assets", file), "utf8")).join("\n");
const fonts = [...css.matchAll(/url\((?:"|')?([^\)"']+\.woff2)(?:"|')?\)/g)].map((match) => match[1].replace(/^\//, ""));
const missing = fonts.filter((font) => !fs.existsSync(path.join(dist, font)));
const notCached = fonts.filter((font) => !manifest.precache.includes(font));
const license = fs.existsSync(path.join(dist, "licenses", "geist-OFL.txt")) && fs.existsSync(path.join(dist, "licenses", "geist-mono-OFL.txt"));
const ok = fonts.length >= 2 && missing.length === 0 && notCached.length === 0 && license && manifest.apiCaching === false;
console.log(JSON.stringify({ fonts, missing, notCached, license, apiCaching: manifest.apiCaching }, null, 2));
console.log(ok ? "BUILD-ASSETS-PASS" : "BUILD-ASSETS-FAIL");
process.exit(ok ? 0 : 1);
