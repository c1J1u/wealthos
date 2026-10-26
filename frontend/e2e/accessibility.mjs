import { chromium } from "playwright";
import AxeBuilder from "@axe-core/playwright";

const base = process.env.WEB_URL ?? "http://127.0.0.1:8793";
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
const page = await context.newPage();
const results = [];
async function settleTheme(theme) {
  await page.waitForFunction((expected) => {
    const light = getComputedStyle(document.body).backgroundColor === "rgb(255, 255, 255)";
    return light === (expected === "light");
  }, theme, { polling: 100 });
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}
for (const route of ["overview", "transactions", "accounts", "income", "expenses", "cashflow", "assets", "investments", "reports", "analytics", "settings"]) {
  await page.goto(`${base}/#/${route}`, { waitUntil: "networkidle" });
  await settleTheme("dark");
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
  results.push({ route, violations: result.violations.map((item) => ({ id: item.id, impact: item.impact, nodes: item.nodes.map((node) => node.target) })) });
}
await page.goto(`${base}/#/settings`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: "切换到浅色主题", exact: true }).click();
for (const route of ["overview", "transactions", "accounts", "income", "expenses", "cashflow", "assets", "investments", "reports", "analytics", "settings"]) {
  await page.goto(`${base}/#/${route}`, { waitUntil: "networkidle" });
  await settleTheme("light");
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
  results.push({ route: `${route}-light`, violations: result.violations.map((item) => ({ id: item.id, impact: item.impact, nodes: item.nodes.map((node) => node.target) })) });
}
await page.setViewportSize({ width: 360, height: 800 });
await page.goto(`${base}/#/transactions`, { waitUntil: "networkidle" });
const mobileResult = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
results.push({ route: "transactions-light-mobile", violations: mobileResult.violations.map((item) => ({ id: item.id, impact: item.impact, nodes: item.nodes.map((node) => node.target) })) });
await page.goto(`${base}/#/assets`, { waitUntil: "networkidle" });
await page.locator(".data-table tbody tr").first().click();
await page.waitForFunction(() => document.querySelector(".drawer") !== null, undefined, { polling: 100 });
const drawerResult = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
results.push({ route: "asset-drawer", violations: drawerResult.violations.map((item) => ({ id: item.id, impact: item.impact, nodes: item.nodes.map((node) => node.target) })) });
console.log(JSON.stringify(results, null, 2));
const failures = results.filter((result) => result.violations.length > 0);
console.log(failures.length === 0 ? "ACCESSIBILITY-PASS" : "ACCESSIBILITY-FAIL");
await browser.close();
process.exit(failures.length === 0 ? 0 : 1);
