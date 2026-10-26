// Playwright smoke: P1 pages render from the mock API, drawer opens,
// deferred pages show explicit empty states, no console errors, no h-scroll.
import { chromium } from "playwright";

const base = process.env.WEB_URL ?? "http://127.0.0.1:8793";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

const results = {};
await page.goto(`${base}/#/overview`, { waitUntil: "networkidle" });
await page.waitForTimeout(1200);
results.overview = await page.evaluate(() => ({
  kpis: document.querySelectorAll(".metric-card").length,
  widgets: document.querySelectorAll(".grid-4-widgets .panel").length,
  hScroll: document.body.scrollWidth > window.innerWidth + 1,
}));

await page.goto(`${base}/#/transactions`, { waitUntil: "networkidle" });
await page.waitForTimeout(600);
results.transactions = await page.evaluate(() => ({ rows: document.querySelectorAll('[data-panel="transactions"] .data-table tbody tr').length }));
await page.locator('[data-panel="transactions"] .data-table tbody tr').first().click();
await page.waitForTimeout(400);
results.drawer = await page.evaluate(() => ({
  open: !!document.querySelector(".drawer"),
  entries: document.querySelectorAll(".drawer .data-table tbody tr").length,
}));
await page.keyboard.press("Escape");

for (const p of ["accounts", "income", "expenses", "cashflow", "assets", "investments", "reports", "analytics", "settings"]) {
  await page.goto(`${base}/#/${p}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  results[p] = await page.evaluate(() => ({
    err: !!document.querySelector(".error-state"),
    hScroll: document.body.scrollWidth > window.innerWidth + 1,
  }));
}
for (const p of ["liabilities", "savings", "budgets", "goals", "forecast", "review", "automation"]) {
  await page.goto(`${base}/#/${p}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(400);
  results[p] = await page.evaluate(() => ({ deferred: !!document.querySelector(".empty-state__title") }));
}

await page.setViewportSize({ width: 768, height: 1024 });
await page.goto(`${base}/#/transactions`, { waitUntil: "networkidle" });
await page.waitForTimeout(600);
results.tablet = await page.evaluate(() => ({ hScroll: document.body.scrollWidth > window.innerWidth + 1 }));

// Keyboard path: Tab from the first nav item should reach page content links/rows.
await page.goto(`${base}/#/overview`, { waitUntil: "networkidle" });
await page.waitForTimeout(500);
await page.keyboard.press("Tab");
let guard = 0;
while (guard++ < 40) {
  const cls = await page.evaluate(() => document.activeElement?.className ?? "");
  if (String(cls).includes("nav-item")) break;
  await page.keyboard.press("Tab");
}
results.keyboardNav = await page.evaluate(() => String(document.activeElement?.className ?? "").includes("nav-item"));

await page.setViewportSize({ width: 360, height: 800 });
await page.goto(`${base}/#/overview`, { waitUntil: "networkidle" });
await page.waitForTimeout(700);
results.mobile = await page.evaluate(() => ({ hScroll: document.body.scrollWidth > window.innerWidth + 1 }));

results.consoleErrors = errors;
console.log(JSON.stringify(results, null, 1));
const ok =
  results.overview.kpis === 10 && results.overview.widgets === 4 && !results.overview.hScroll &&
  results.transactions.rows > 0 && results.drawer.open && results.drawer.entries >= 2 &&
  ["accounts","income","expenses","cashflow","assets","investments","reports","analytics","settings"].every((p) => !results[p].err && !results[p].hScroll) &&
  ["liabilities","savings","budgets","goals","forecast","review","automation"].every((p) => results[p].deferred) &&
  !results.mobile.hScroll && results.tablet.hScroll === false && results.keyboardNav === true && errors.length === 0;
console.log(ok ? "SMOKE-PASS" : "SMOKE-FAIL");
await browser.close();
process.exit(ok ? 0 : 1);
