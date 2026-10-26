import { chromium } from "playwright";

const base = process.env.WEB_URL ?? "http://127.0.0.1:8793";
const readOnlyBase = process.env.P1_WEB_URL ?? "http://127.0.0.1:8793";
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" });
const page = await context.newPage();
const errors = [];
const creates = [];
page.on("pageerror", (error) => errors.push(error.message));
await page.route("**/v1/transactions/preview**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: { transaction_type: "EXPENSE", amount_cents: 9900, balanced: true, debit_total_cents: 9900, credit_total_cents: 9900, entries: [] }, meta: { request_id: "preview" } }) }));
await page.route("**/v1/transactions", async (route) => {
  if (route.request().method() !== "POST") return route.fallback();
  creates.push({ headers: route.request().headers(), body: route.request().postDataJSON() });
  await route.fulfill(creates.length === 1
    ? { status: 503, contentType: "application/json", body: JSON.stringify({ type: "about:blank", status: 503, code: "DATABASE_UNAVAILABLE", title: "temporary" }) }
    : { status: 201, contentType: "application/json", body: JSON.stringify({ data: { transaction_id: "txn-retry", replayed: true } }) });
});

await page.goto(`${base}/#/transactions`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: "记一笔", exact: true }).click();
await page.fill('input[aria-label="记账金额"]', "99");
await page.fill('input[aria-label="交易日期"]', "2025-07-01");
const ids = await page.locator('select[aria-label="付款账户"] option').evaluateAll((options) => options.map((option) => option.value).filter(Boolean));
await page.selectOption('select[aria-label="付款账户"]', ids[0]);
await page.selectOption('select[aria-label="记账分类"]', "FOOD_LUNCH");
await page.getByRole("button", { name: "生成分录预览", exact: true }).click();
await page.getByRole("button", { name: "确认提交真实账本", exact: true }).click();
await page.waitForFunction(() => document.querySelector(".command-feedback")?.textContent?.includes("temporary"), undefined, { polling: 100 });
await page.getByRole("button", { name: "重试同一提交", exact: true }).click();
await page.waitForFunction(() => document.querySelector(".command-success")?.textContent?.includes("重放首次提交"), undefined, { polling: 100 });
const retry = creates.length === 2 && creates[0].headers["idempotency-key"] === creates[1].headers["idempotency-key"];

const p1 = await context.newPage();
await p1.goto(`${readOnlyBase}/#/transactions`, { waitUntil: "networkidle" });
const p1ReadOnly = await p1.getByRole("button", { name: "记一笔", exact: true }).count() === 0
  && await p1.locator(".readonly-badge").textContent() === "只读模式";
await p1.close();

const voided = await context.newPage();
await voided.route(/\/v1\/transactions\/[^/]+\/entries(?:\?.*)?$/, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: [], meta: { request_id: "voided-entries" } }) }));
await voided.route(/\/v1\/transactions\/[^/]+(?:\?.*)?$/, (route) => {
  const id = new URL(route.request().url()).pathname.split("/")[3];
  return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: { transaction_id: id, transaction_type: "EXPENSE", amount_cents: 100, currency: "CNY", transaction_date: "2025-06-01", posting_date: "2025-06-01", status: "VOIDED", data_state: "ACTUAL", voided_by_transaction_id: "reversal-1", version: 1, entries: [] }, meta: { request_id: "voided" } }) });
});
let voidCalls = 0;
await voided.route(/\/v1\/transactions\/[^/]+\/void(?:\?.*)?$/, () => { voidCalls += 1; });
await voided.goto(`${base}/#/transactions`, { waitUntil: "networkidle" });
await voided.locator('[data-panel="transactions"] .data-table tbody tr').first().click();
await voided.waitForFunction(() => document.querySelector(".drawer .panel__title")?.textContent?.includes("分录"), undefined, { polling: 100 });
const voidDisabled = await voided.getByRole("button", { name: "冲销此交易", exact: true }).isDisabled();

console.log(JSON.stringify({ retry, p1ReadOnly, voidDisabled, voidCalls, errors }, null, 2));
const ok = retry && p1ReadOnly && voidDisabled && voidCalls === 0 && errors.length === 0;
console.log(ok ? "COMMAND-BOUNDARIES-PASS" : "COMMAND-BOUNDARIES-FAIL");
await browser.close();
process.exit(ok ? 0 : 1);
