import { chromium } from "playwright";

const base = process.env.WEB_URL ?? "http://127.0.0.1:8793";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ serviceWorkers: "block", viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
const errors = [];
const requests = [];
page.on("pageerror", (error) => errors.push(error.message));
const entry = { entry_id: "entry-preview", transaction_id: "preview", line_no: 1, direction: "DEBIT", amount_cents: 684350, ledger_account_id: "ledger-1", ledger_account_code: "LOAN", flow_effect: "DEBT_PRINCIPAL_REPAY", entry_role: "PRIMARY" };

// One dispatcher avoids route-shadowing and records every command, while
// never forwarding a write to a real ledger.
await page.route("**/v1/**", async (route) => {
  const request = route.request();
  const url = new URL(request.url());
  if (url.origin !== base || request.method() !== "POST") return route.fallback();
  const body = request.postDataJSON();
  requests.push({ path: url.pathname, body, headers: request.headers() });
  if (url.pathname === "/v1/transactions/preview") {
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: { transaction_type: body.transaction_type, amount_cents: body.amount_cents, balanced: true, debit_total_cents: body.amount_cents, credit_total_cents: body.amount_cents, entries: [entry, { ...entry, entry_id: "entry-2", line_no: 2, direction: "CREDIT", entry_role: "FUNDING" }] }, meta: { request_id: "preview" } }) });
  }
  if (url.pathname === "/v1/transactions") {
    await new Promise((resolve) => setTimeout(resolve, 150));
    return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ data: { transaction_id: "txn-1", replayed: false } }) });
  }
  if (url.pathname.endsWith("/void")) return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ data: { transaction_id: "reversal-1", replayed: false } }) });
  return route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ code: "NOT_FOUND" }) });
});

async function state(label) {
  return { label, requests, text: await page.locator("main").textContent(), drawer: await page.locator(".drawer").textContent().catch(() => "") };
}

try {
  await page.goto(`${base}/#/transactions`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "记一笔", exact: true }).click();
  const repaymentHiddenInitially = await page.locator('input[aria-label="偿还本金"]').isHidden();
  await page.selectOption('select[aria-label="记账类型"]', "LOAN_REPAYMENT");
  await page.fill('input[aria-label="记账金额"]', "6843.50");
  await page.fill('input[aria-label="交易日期"]', "2025-07-10");
  const ids = await page.locator('select[aria-label="付款账户"] option').evaluateAll((options) => options.map((option) => option.value).filter(Boolean));
  await page.selectOption('select[aria-label="付款账户"]', ids[0]);
  const mortgageId = await page.locator('select[aria-label="到账或负债账户"] option').evaluateAll((options) => options.find((option) => option.textContent === "住房贷款")?.value);
  if (!mortgageId) throw new Error("还款表单缺少住房贷款负债账户");
  await page.selectOption('select[aria-label="到账或负债账户"]', mortgageId);
  await page.fill('input[aria-label="偿还本金"]', "3929.15");
  await page.fill('input[aria-label="偿还利息"]', "2914.35");
  await page.fill('input[aria-label="偿还费用"]', "0");
  await page.getByRole("button", { name: "生成分录预览", exact: true }).click();
  await page.waitForFunction(() => document.querySelector(".command-preview")?.textContent?.includes("已平衡"), undefined, { polling: 100, timeout: 8000 });
  const previewUnlocked = await page.getByRole("button", { name: "确认提交真实账本", exact: true }).isEnabled();
  await page.fill('input[aria-label="偿还费用"]', "1");
  const editLocked = !(await page.getByRole("button", { name: "确认提交真实账本", exact: true }).isEnabled());
  await page.fill('input[aria-label="偿还费用"]', "0");
  await page.getByRole("button", { name: "生成分录预览", exact: true }).click();
  await page.waitForFunction(() => document.querySelector(".command-preview")?.textContent?.includes("已平衡"), undefined, { polling: 100, timeout: 8000 });
  await page.getByRole("button", { name: "确认提交真实账本", exact: true }).evaluate((button) => { button.click(); button.click(); });
  await page.waitForFunction(() => document.querySelector(".command-success")?.textContent?.includes("txn-1"), undefined, { polling: 100, timeout: 8000 });
  await page.getByRole("button", { name: "关闭", exact: true }).click();

  await page.locator('[data-panel="transactions"] .data-table tbody tr').first().click();
  await page.getByRole("button", { name: "冲销此交易", exact: true }).click();
  const beforeVoid = requests.filter((request) => request.path.endsWith("/void")).length;
  await page.getByRole("button", { name: "确认冲销？将生成反向交易", exact: true }).click();
  await page.waitForFunction(() => document.querySelector(".command-success")?.textContent?.includes("reversal-1"), undefined, { polling: 100, timeout: 8000 });

  const creates = requests.filter((request) => request.path === "/v1/transactions");
  const previews = requests.filter((request) => request.path.endsWith("/preview"));
  const voids = requests.filter((request) => request.path.endsWith("/void"));
  const ok = repaymentHiddenInitially && previews.length === 2 && previews.every((request) => request.body.repayment_meta && !("repayment" in request.body) && !request.headers["idempotency-key"])
    && creates.length === 1 && creates[0].body.repayment && !("repayment_meta" in creates[0].body) && creates[0].headers["idempotency-key"]
    && previewUnlocked && editLocked && beforeVoid === 0 && voids.length === 1 && voids[0].headers["idempotency-key"] !== creates[0].headers["idempotency-key"] && errors.length === 0;
  console.log(JSON.stringify({ repaymentHiddenInitially, previewUnlocked, editLocked, creates: creates.length, previews: previews.length, voids: voids.length, errors, ok }, null, 2));
  console.log(ok ? "TRANSACTION-COMMANDS-PASS" : "TRANSACTION-COMMANDS-FAIL");
  await browser.close();
  process.exit(ok ? 0 : 1);
} catch (error) {
  console.error("COMMAND-STATE", JSON.stringify(await state("failed")));
  await browser.close();
  throw error;
}
