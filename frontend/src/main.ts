import "./styles/app.css";
import { renderShell, renderNav, NAV } from "./app/shell";
import { parseHash, onRouteChange } from "./app/router";
import { api, pairingRequests, queryClient, setCsrfToken } from "./data/store";
import { readTheme } from "./app/preferences";
import { SessionBootstrap } from "./app/bootstrap";
import { el } from "./components/dom";
import { normalizeQueryError } from "./data/query";
import { errorState, skeleton } from "./components/states";
import { registerOfflineShell } from "./offline/register";
import { APP_MODE } from "./app/mode";
import { activeDemoPersona, selectDemoPersona, writeDemoPersona } from "./app/demo-persona";
import { resetSessionContext } from "./app/session";
import { localeName, translateLocale } from "./app/locale";
import { readLanguage } from "./app/preferences";
import { PairingController } from "./app/pairing";

const root = document.getElementById("app")!;
registerOfflineShell();
document.documentElement.dataset.theme = readTheme();
document.body.dataset.appMode = APP_MODE;
translateLocale(readLanguage());

const shell = renderShell(root);
const TITLES: Record<string, string> = Object.fromEntries(NAV.map((n) => [n.page, n.label]));

let activeController: AbortController | null = null;
const session = new SessionBootstrap(api, shell);
function reconnectSession(): void {
  setCsrfToken(undefined);
  const controller = activeController;
  if (controller) controller.abort();
  queryClient.nextGeneration();
  queryClient.clear();
  resetSessionContext();
  void session.reconnect().then((ready) => {
    if (ready) void paint(parseHash(location.hash));
  });
}

const pairing = new PairingController(api, async () => {
  queryClient.nextGeneration();
  queryClient.clear();
  resetSessionContext();
  session.reset();
  setCsrfToken(pairing.getCsrfToken());
  void paint(parseHash(location.hash));
});
pairingRequests.addEventListener("pairing-required", () => pairing.request());

async function paint(route: { page: string; params: URLSearchParams }): Promise<void> {
  activeController?.abort();
  const controller = new AbortController();
  activeController = controller;
  const signal = controller.signal;
  if (APP_MODE === "demo") {
    const previous = activeDemoPersona();
    const persona = selectDemoPersona(route.params.get("demo_persona"));
    if (persona !== previous) {
      // Invalidate old-key requests before changing the demo request context.
      queryClient.nextGeneration();
      queryClient.clear();
      resetSessionContext();
      session.reset();
      writeDemoPersona(undefined, persona);
    }
    shell.setDemoPersona(persona);
  }
  if (!(await session.ensure(signal))) {
    if (!signal.aborted) showSessionError(route);
    return;
  }
  queryClient.nextGeneration();
  const knownPage = Boolean(TITLES[route.page]);
  const page = knownPage ? route.page : "overview";
  renderNav(shell.nav, page);
  shell.title.textContent = localeName(page);
  document.title = `${localeName(page)} · WealthOS`;
  if (!knownPage) {
    history.replaceState(null, "", "#/overview?reason=unknown-route");
  }

  shell.content.setAttribute("aria-busy", "true");
  shell.content.setAttribute("aria-label", `${TITLES[page] ?? "总览"}加载中`);
  shell.content.replaceChildren(el("div", { className: "page-loading", role: "status", "aria-live": "polite" }, [
    el("h1", { textContent: TITLES[page] ?? "总览" }),
    el("p", { className: "cell-muted", textContent: "正在加载页面与数据" }),
    skeleton(80), skeleton(220),
  ]));
  const ctx = { root: shell.content, signal, setTheme: shell.setTheme, updatePreferences: shell.updatePreferences };
  try {
    switch (page) {
      case "overview": { const { renderOverview } = await import("./pages/overview"); await renderOverview(shell.content, signal); break; }
      case "transactions": { const { renderTransactions } = await import("./pages/transactions"); await renderTransactions(shell.content, route.params, signal); break; }
      case "accounts": { const { renderAccounts } = await import("./pages/accounts"); await renderAccounts(ctx); break; }
      case "income": { const { renderIncome } = await import("./pages/income"); await renderIncome({ ...ctx, params: route.params }); break; }
      case "expenses": { const { renderExpenses } = await import("./pages/expenses"); await renderExpenses({ ...ctx, params: route.params }); break; }
      case "cashflow": { const { renderCashflow } = await import("./pages/cashflow"); await renderCashflow({ ...ctx, params: route.params }); break; }
      case "assets": { const { renderAssets } = await import("./pages/assets"); await renderAssets(ctx); break; }
      case "investments": { const { renderInvestments } = await import("./pages/investments"); await renderInvestments(ctx); break; }
      case "analytics": { const { renderAnalytics } = await import("./pages/analytics"); await renderAnalytics({ ...ctx, params: route.params }); break; }
      case "reports": { const { renderReports } = await import("./pages/reports"); await renderReports({ ...ctx, params: route.params }); break; }
      case "settings": { const { renderSettings } = await import("./pages/settings"); await renderSettings(ctx); break; }
      default: { const { renderDeferred } = await import("./pages/simple"); renderDeferred(page)(ctx); break; }
    }
  } catch (error) {
    // Keep an unexpected malformed response or render defect recoverable.
    if (!signal.aborted) shell.content.replaceChildren(errorState(normalizeQueryError(error), () => { void paint(route); }));
  } finally {
    if (activeController === controller) activeController = null;
    if (!signal.aborted) {
      shell.content.setAttribute("aria-busy", "false");
      shell.content.removeAttribute("aria-label");
    }
  }
  if (!knownPage && !signal.aborted) {
    const notice = el("div", { className: "partial-state", role: "status", textContent: "未找到该页面，已返回总览。" });
    shell.content.prepend(notice);
  }
}

function showSessionError(route: { page: string; params: URLSearchParams }): void {
  const failure = session.error;
  if (!failure) return;
  if (failure.code === "PAIRING_REQUIRED" || failure.code === "SESSION_INVALID") {
    shell.content.setAttribute("aria-busy", "false");
    const pairButton = el("button", { className: "button button--primary", textContent: "输入配对码" });
    pairButton.addEventListener("click", () => pairing.open());
    shell.content.replaceChildren(el("section", { className: "panel pairing-gate" }, [
      el("h1", { textContent: "需要配对此设备" }),
      el("p", { className: "cell-muted", textContent: "当前账本需要一次性配对。配对后才能读取或写入；原页面与筛选条件会保留。" }),
      pairButton,
    ]));
    pairing.open();
    return;
  }
  shell.content.setAttribute("aria-busy", "false");
  shell.content.replaceChildren(errorState(failure, undefined, { onReconnect: reconnectSession }));
}

onRouteChange((route) => { void paint(route); });
document.addEventListener("wealthos:localechange", () => {
  translateLocale(readLanguage());
  renderNav(shell.nav, parseHash(location.hash).page);
  const page = parseHash(location.hash).page;
  shell.title.textContent = localeName(page);
  document.title = `${localeName(page)} · WealthOS`;
});
void paint(parseHash(location.hash));
