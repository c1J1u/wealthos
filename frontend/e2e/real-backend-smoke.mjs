// Browser evidence for real-backend integration, not the mock gate.
// Expects frontend started with WEALTHOS_API_TARGET=http://127.0.0.1:8787.
import { chromium } from "playwright";

const base = process.env.WEB_URL ?? "http://127.0.0.1:8793";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ serviceWorkers: "block", viewport: { width: 1440, height: 900 } });
const errors = [];
const failedResponses = [];
const successfulRequests = [];
page.on("pageerror", (error) => errors.push(error.message));
page.on("response", (response) => {
  if (response.url().includes("/v1/") && response.status() >= 400) failedResponses.push(`${response.status()} ${response.url()}`);
  if (response.url().includes("/v1/") && response.status() >= 200 && response.status() < 300) successfulRequests.push(response.url());
});
const results = [];
const pageTitles = { overview: "总览", transactions: "流水", accounts: "账户", income: "收入", expenses: "支出", cashflow: "现金流", assets: "资产", investments: "投资", reports: "报表", analytics: "分析", settings: "设置" };

for (const route of ["overview", "transactions", "accounts", "income", "expenses", "cashflow", "assets", "investments", "reports", "analytics", "settings"]) {
  const before = failedResponses.length;
  const beforeSuccess = successfulRequests.length;
  const routeQuery = route === "analytics" ? "?metric=net_worth&range=6m&chart=line" : "";
  await page.goto(`${base}/#/${route}${routeQuery}`, { waitUntil: "networkidle" });
  console.log(`checking ${route}`);
  // The router deliberately aborts the previous page on navigation. Wait for
  // this page to reach a visible terminal state before moving on.
  await page.waitForFunction((title) => document.querySelector("h1")?.textContent === title && document.querySelector("main")?.getAttribute("aria-busy") === "false" &&
    [...document.querySelectorAll(".panel__body")].every((node) => node.getAttribute("aria-busy") === "false" && (node.textContent?.length ?? 0) > 0), pageTitles[route], { polling: 100, timeout: 15000 });
  results.push(await page.evaluate((route) => ({
    route,
    title: document.querySelector("h1")?.textContent,
    cards: document.querySelectorAll(".metric-card").length,
    rows: document.querySelectorAll(".data-table tbody tr").length,
    error: document.querySelector(".error-state")?.textContent?.slice(0, 180) ?? null,
    empty: document.querySelector(".empty-state")?.textContent?.slice(0, 160) ?? null,
    values: [...document.querySelectorAll(".metric-card__value")].slice(0, 4).map((n) => n.textContent),
    hScroll: document.body.scrollWidth > window.innerWidth + 1,
    panels: [...document.querySelectorAll(".panel")].filter((node) => node.querySelector(".panel__body") && !node.classList.contains("panel--placeholder")).map((node) => ({
      title: node.querySelector(".panel__title")?.textContent,
      busy: node.querySelector(".panel__body")?.getAttribute("aria-busy"),
      terminal: Boolean(node.querySelector(".error-state, .empty-state, .chart-canvas, .data-table tbody tr, .kv, form, .segmented, details, .metric-card")),
      error: node.querySelector(".error-state")?.textContent?.slice(0, 220) ?? null,
    })),
  }), route));
  results.at(-1).failedResponses = failedResponses.slice(before);
  results.at(-1).successfulRequests = successfulRequests.slice(beforeSuccess);
  results.at(-1).terminal = results.at(-1).panels.every((panel) => panel.busy === "false" && (panel.terminal || panel.title === "显示偏好" || panel.title === "导航模块"));
  console.log(JSON.stringify(results.at(-1)));
}
const notTerminal = results.filter((result) => !result.terminal).map((result) => result.route);
console.log(JSON.stringify({ results, failedResponses, errors, notTerminal }, null, 2));
await browser.close();
process.exit(errors.length > 0 || failedResponses.length > 0 || notTerminal.length > 0 ? 1 : 0);
