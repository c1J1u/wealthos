import { chromium } from "playwright";

const base = process.env.WEB_URL ?? "http://127.0.0.1:8793";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce", serviceWorkers: "block" });
const routes = {
  overview: ["总览", "Overview"], transactions: ["流水", "Transactions"], accounts: ["账户", "Accounts"],
  income: ["收入", "Income"], expenses: ["支出", "Expenses"], cashflow: ["现金流", "Cash flow"],
  assets: ["资产", "Assets"], liabilities: ["负债", "Liabilities"], savings: ["储蓄", "Savings"],
  investments: ["投资", "Investments"], budgets: ["预算", "Budgets"], goals: ["目标", "Goals"],
  analytics: ["分析", "Analytics"], forecast: ["预测", "Forecast"], review: ["复盘", "Review"],
  reports: ["报表", "Reports"], automation: ["自动化", "Automation"], settings: ["设置", "Settings"],
};
const failures = [];
const titles = [];
const errors = [];
const evidence = new Map();
let apiRequests = 0;
page.on("pageerror", (error) => errors.push(error.message));
page.on("request", (request) => { if (new URL(request.url()).pathname.startsWith("/v1/")) apiRequests++; });

async function open(route) {
  await page.goto(`${base}/#/${route}`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => document.querySelector("main")?.getAttribute("aria-busy") === "false", undefined, { polling: 100 });
  if (route === "accounts") await page.waitForFunction(() => document.querySelectorAll(".account-card__name").length > 0 && [...document.querySelectorAll(".panel__body")].every((node) => node.getAttribute("aria-busy") === "false"), undefined, { polling: 100 });
}

try {
  await page.goto(`${base}/#/overview`, { waitUntil: "networkidle" });
  await page.evaluate(() => { localStorage.removeItem("wealthos.lang"); localStorage.removeItem("wealthos.ui"); });
  for (const [route, names] of Object.entries(routes)) {
    await open(route);
    const actual = await page.locator(".topbar__title").textContent();
    titles.push({ locale: "zh", route, actual });
    if (actual !== names[0]) failures.push(`zh title ${route}: ${actual}`);
    evidence.set(route, await page.evaluate((route) => ({
      names: [...document.querySelectorAll(".account-card__name")].map((node) => node.textContent),
      merchants: route === "transactions" ? [...document.querySelectorAll(".data-table tbody tr td:nth-child(2)")].map((node) => node.textContent) : [],
      codes: [...document.querySelectorAll(".error-state__code")].map((node) => node.textContent),
      ids: [...document.querySelectorAll(".kv dd")].map((node) => node.textContent).filter((text) => /[0-9a-f-]{36}/.test(text ?? "")),
    }), route));
  }
  await open("settings");
  const beforeSwitch = apiRequests;
  await page.locator('select[data-language="interface"]').selectOption("en");
  await page.waitForFunction(() => document.documentElement.lang === "en" && document.querySelector(".topbar__title")?.textContent === "Settings");
  const switchApiRequests = apiRequests - beforeSwitch;
  if (switchApiRequests !== 0) failures.push(`locale switch made ${switchApiRequests} financial requests`);
  if (await page.locator('select[data-language="interface"]').inputValue() !== "en") failures.push("language selector did not retain value");
  if (await page.evaluate(() => localStorage.getItem("wealthos.lang")) !== "en") failures.push("language preference not persisted");

  for (const [route, names] of Object.entries(routes)) {
    await open(route);
    const actual = await page.locator(".topbar__title").textContent();
    titles.push({ locale: "en", route, actual });
    if (actual !== names[1]) failures.push(`en title ${route}: ${actual}`);
    const lang = await page.locator("html").getAttribute("lang");
    if (lang !== "en") failures.push(`html lang ${route}: ${lang}`);
    const englishEvidence = await page.evaluate((route) => ({
      names: [...document.querySelectorAll(".account-card__name")].map((node) => node.textContent),
      merchants: route === "transactions" ? [...document.querySelectorAll(".data-table tbody tr td:nth-child(2)")].map((node) => node.textContent) : [],
      codes: [...document.querySelectorAll(".error-state__code")].map((node) => node.textContent),
      ids: [...document.querySelectorAll(".kv dd")].map((node) => node.textContent).filter((text) => /[0-9a-f-]{36}/.test(text ?? "")),
    }), route);
    if (JSON.stringify(evidence.get(route)) !== JSON.stringify(englishEvidence)) failures.push(`dynamic financial evidence changed on ${route}: ${JSON.stringify({ before: evidence.get(route), after: englishEvidence })}`);
    if (route === "accounts") {
      const types = await page.locator(".data-table tbody tr td:nth-child(2)").allTextContents();
      if (types.some((text) => /[\u4e00-\u9fff]/.test(text))) failures.push("fixed account subtype labels were not translated");
    }
  }
  await page.reload({ waitUntil: "networkidle" });
  if (await page.locator(".topbar__title").textContent() !== "Settings") failures.push("English did not persist on reload");
  await open("transactions");
  await page.locator(".topbar__search").fill("盒马");
  const inputValue = await page.locator(".topbar__search").inputValue();
  if (inputValue !== "盒马") failures.push("dynamic input was translated");
  await page.getByRole("button", { name: "New transaction", exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.drawer input[aria-label="Amount"]')?.getClientRects().length > 0, undefined, { polling: 100, timeout: 15000 });
  const command = await page.evaluate(() => ({
    placeholder: document.querySelector('input[aria-label="Amount"]')?.placeholder,
    submit: [...document.querySelectorAll(".drawer button")].map((node) => node.textContent),
    accountOptions: [...document.querySelectorAll('select[aria-label="Source account"] option')].map((node) => ({ text: node.textContent, value: node.value })),
    overflow: document.documentElement.scrollWidth > innerWidth + 1,
  }));
  if (command.placeholder !== "For example, 99.00") failures.push(`command amount placeholder: ${command.placeholder}`);
  if (!command.submit.includes("Preview entries")) failures.push("command preview label missing");
  if (command.accountOptions.slice(1).some((option) => option.text.includes("Source account") || option.text.includes("Brokerage account") || option.value.includes("Account"))) failures.push("account data was translated");
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await open("settings");
  const hashBeforeSwitch = await page.evaluate(() => location.hash);
  await page.locator('select[data-language="interface"]').selectOption("zh");
  await page.waitForFunction(() => document.querySelector(".topbar__title")?.textContent === "设置");
  if (await page.evaluate(() => location.hash) !== hashBeforeSwitch) failures.push("language switch changed route");
  if (await page.locator("main").textContent().then((text) => !text.includes("显示偏好"))) failures.push("Chinese copy did not restore");
  await page.setViewportSize({ width: 360, height: 800 });
  await page.locator('select[data-language="interface"]').selectOption("en");
  await page.waitForFunction(() => document.documentElement.lang === "en");
  const mobile = await page.evaluate(() => ({ overflow: document.documentElement.scrollWidth > innerWidth + 1, title: document.querySelector(".topbar__title")?.textContent }));
  if (mobile.overflow) failures.push("English mobile settings overflow");
  if (await page.locator("main").textContent().then((text) => text.includes("单账本"))) failures.push("untranslated mode label in settings");
  await open("transactions");
  const residue = await page.evaluate(() => [...document.querySelectorAll(".data-table .badge, select option")].map((node) => node.textContent ?? "").filter((text) => text.includes("资产重估") || text === "流入" || text === "流出" || text === "已入账" || text === "未对账"));
  if (residue.length > 0) failures.push(`untranslated transaction badges: ${residue.join(",")}`);
  const fixedResidue = await page.evaluate(() => [...document.querySelectorAll("main .panel__title, main .chart-caption, main .metric-card__delta, main .account-card__meta, main .cell-muted")]
    .filter((node) => !node.closest(".error-state") && /[\u4e00-\u9fff]/.test(node.textContent ?? "") && !node.closest(".kv") && ![...node.childNodes].some((child) => child.__wealthosRaw))
    .map((node) => node.textContent).filter((text) => !/招商银行|蚂蚁集团|中信证券|深圳公积金中心|合并口径|所有已入账交易|null 资金腿|笔未分类/.test(text ?? "")));
  if (fixedResidue.length > 0) failures.push(`fixed UI residue: ${fixedResidue.join(" | ")}`);
  await page.locator('[data-panel="transactions"] .data-table tbody tr').first().click();
  await page.waitForFunction(() => document.querySelector(".drawer")?.textContent?.includes("Entries (balanced)"), undefined, { polling: 100, timeout: 15000 });
  const detail = await page.locator(".drawer").textContent();
  if (!detail.includes("Reconciliation") || !detail.includes("盒马鲜生") || !detail.includes("食材采购")) failures.push("English transaction detail or raw merchant/category incorrect");
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await open("accounts");
  await page.locator(".account-card").first().click();
  await page.waitForFunction(() => document.querySelector(".drawer")?.textContent?.includes("Recent entries"), undefined, { polling: 100, timeout: 15000 });
  const accountDetail = await page.locator(".drawer").textContent();
  if (!accountDetail.includes("Balance derivation") || !accountDetail.includes("招商银行 · 活期")) failures.push("English account detail or raw account name incorrect");
  await page.keyboard.press("Escape");
  await open("transactions");
  await page.getByRole("button", { name: "New transaction", exact: true }).click();
  await page.locator(".drawer").waitFor();
  await page.getByRole("button", { name: "Preview entries", exact: true }).click();
  await page.waitForFunction(() => document.querySelector(".command-feedback")?.textContent?.includes("Enter a positive amount"), undefined, { polling: 100 });
  const offlineContext = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: "block" });
  await offlineContext.addInitScript(() => localStorage.setItem("wealthos.lang", "en"));
  const offlinePage = await offlineContext.newPage();
  await offlinePage.route("**/v1/**", (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ code: "DATABASE_UNAVAILABLE", title: "数据服务不可用", detail: "服务暂不可用", request_id: "i18n-proof" }) }));
  await offlinePage.goto(`${base}/#/overview`, { waitUntil: "networkidle" });
  await offlinePage.waitForSelector("main .error-state");
  const failureState = await offlinePage.locator("main").textContent();
  if (!failureState.includes("Data service unavailable")) failures.push("English service failure missing");
  if (!failureState.includes("DATABASE_UNAVAILABLE")) failures.push("API diagnostic code was not preserved");
  if (!failureState.includes("服务暂不可用") || failureState.includes("指标接口不可用")) failures.push("raw server diagnostic or fixed empty state incorrect");
  await offlineContext.close();
  console.log(JSON.stringify({ titles, switchApiRequests, command, mobile, failureState, errors, failures }, null, 2));
  console.log(failures.length === 0 && errors.length === 0 ? "I18N-PASS" : "I18N-FAIL");
  await browser.close();
  process.exit(failures.length === 0 && errors.length === 0 ? 0 : 1);
} catch (error) {
  console.error("I18N-FAIL", { failures, errors, title: await page.locator(".topbar__title").textContent().catch(() => "") });
  await browser.close();
  throw error;
}
