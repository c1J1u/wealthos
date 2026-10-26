import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const root = new URL("../", import.meta.url).pathname;
const files = execFileSync("git", ["ls-files", "-co", "--exclude-standard"], { cwd: root, encoding: "utf8" }).trim().split("\n").filter(Boolean);
const forbidden = [
  [/(?:byte\s*dance|volc\s*engine|volces|字节跳动|火山引擎)/i, "private organization or cloud vendor"],
  [/rds-pg|\.certs\/|BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY/, "private endpoint or credential material"],
  [/postgres(?:ql)?:\/\/[^\s:@/]+:[^\s@/]+@[^\s/]+/i, "embedded database password"],
  [/\/Users\/|\/home\/[A-Za-z0-9_.-]+|[A-Za-z]:\\\\Users\\\\/i, "developer-specific absolute path"],
];
const errors = [];
for (const file of files) {
  if (file === "scripts/check-public.mjs") continue;
  const buffer = readFileSync(new URL(`../${file}`, import.meta.url));
  if (buffer.includes(0)) { errors.push(`${file}: binary files are not part of the minimal release`); continue; }
  const text = buffer.toString("utf8");
  for (const [pattern, reason] of forbidden) if (pattern.test(text)) errors.push(`${file}: ${reason}`);
  if (/(?:^|\/)(?:\.env|\.ledger\.json|server\.log)$/.test(file)) errors.push(`${file}: local secret/runtime file`);
}
if (errors.length) { console.error(errors.join("\n")); process.exit(1); }
console.log(`Public-release scan passed: ${files.length} text files; no blocked paths, vendor markers, or embedded credentials.`);
