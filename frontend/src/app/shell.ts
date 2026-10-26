import { el, icon, clear } from "../components/dom";
import { readUiPreferences, writeUiPreferences } from "./preferences";
import { APP_MODE, appModeLabel } from "./mode";
import { COMMANDS_ENABLED, modeStageLabel } from "./mode";
import { readDemoPersona, writeDemoPersona } from "./demo-persona";
import type { DemoPersona } from "./demo-persona";
import { localeName, localizeText } from "./locale";

export interface NavItem {
  page: string;
  label: string;
  icon: string;
  group: string;
  p1: boolean;
  phase?: string;
}

export const NAV: NavItem[] = [
  { page: "overview", label: "总览", icon: "overview", group: "总览", p1: true },
  { page: "transactions", label: "流水", icon: "transactions", group: "资金", p1: true },
  { page: "accounts", label: "账户", icon: "accounts", group: "资金", p1: true },
  { page: "income", label: "收入", icon: "income", group: "资金", p1: true },
  { page: "expenses", label: "支出", icon: "expenses", group: "资金", p1: true },
  { page: "cashflow", label: "现金流", icon: "cashflow", group: "资金", p1: true },
  { page: "assets", label: "资产", icon: "assets", group: "资产负债", p1: true },
  { page: "liabilities", label: "负债", icon: "accounts", group: "资产负债", p1: false, phase: "P3" },
  { page: "savings", label: "储蓄", icon: "assets", group: "资产负债", p1: false, phase: "P3" },
  { page: "investments", label: "投资", icon: "investments", group: "资产负债", p1: true },
  { page: "budgets", label: "预算", icon: "reports", group: "管理", p1: false, phase: "P3" },
  { page: "goals", label: "目标", icon: "assets", group: "管理", p1: false, phase: "P3" },
  { page: "analytics", label: "分析", icon: "analytics", group: "智能", p1: true },
  { page: "forecast", label: "预测", icon: "cashflow", group: "智能", p1: false, phase: "P4" },
  { page: "review", label: "复盘", icon: "reports", group: "智能", p1: false, phase: "P4" },
  { page: "reports", label: "报表", icon: "reports", group: "智能", p1: true },
  { page: "automation", label: "自动化", icon: "settings", group: "智能", p1: false, phase: "P4/P5" },
  { page: "settings", label: "设置", icon: "settings", group: "系统", p1: true },
];

export interface ShellRefs {
  nav: HTMLElement;
  title: HTMLElement;
  asOf: HTMLElement;
  content: HTMLElement;
  sidebar: HTMLElement;
  updatePreferences: () => void;
  setTheme: (theme: "light" | "dark") => void;
  setDemoPersona: (persona: DemoPersona) => void;
}

export function renderShell(root: HTMLElement): ShellRefs {
  clear(root);
  const sidebar = el("aside", { className: "sidebar", id: "sidebar" });
  const brand = el("div", { className: "sidebar__brand" }, [
    el("div", { className: "sidebar__logo", textContent: "W" }),
    el("div", { className: "sidebar__name", textContent: "WealthOS" }),
  ]);
  const mobileClose = el("button", { className: "icon-button sidebar__mobile-close", "aria-label": "关闭导航", title: "关闭导航" });
  mobileClose.append(icon("close", 18));
  brand.append(mobileClose);
  const nav = el("nav", { className: "sidebar__nav", "aria-label": "主导航", id: "main-nav" });
  let preferences = readUiPreferences();
  const collapseButton = el("button", { className: "icon-button sidebar__collapse", "aria-label": preferences.collapsed ? "展开导航" : "折叠导航", "aria-expanded": String(!preferences.collapsed), "aria-controls": "main-nav", title: preferences.collapsed ? "展开导航" : "折叠导航" });
  collapseButton.append(icon(preferences.collapsed ? "chevron-right" : "chevron-left", 17));
  brand.append(collapseButton);
  const status = el("div", { className: "sidebar__status" }, [
    el("span", { className: "readonly-badge", textContent: modeStageLabel(COMMANDS_ENABLED) }),
    el("span", { textContent: "本地服务 · 单账本" }),
  ]);
  if (APP_MODE === "demo") status.prepend(el("span", { className: "app-mode-badge app-mode-badge--demo", textContent: appModeLabel(APP_MODE) }));
  sidebar.append(brand, nav, status);

  const backdrop = el("div", { className: "sidebar-backdrop", hidden: true });
  let main: HTMLElement;
  const menuBtn = el("button", { className: "icon-button", "aria-label": "打开导航", "aria-expanded": "false", "aria-controls": "sidebar" });
  const setOpen = (open: boolean) => {
    const focusWasInSidebar = sidebar.contains(document.activeElement);
    const mobileOpen = mobileQuery.matches && open;
    sidebar.dataset.open = String(open);
    backdrop.hidden = !mobileOpen;
    sidebar.toggleAttribute("inert", mobileQuery.matches && !open);
    sidebar.setAttribute("aria-label", "主导航");
    if (mobileOpen) {
      sidebar.setAttribute("role", "dialog");
      sidebar.setAttribute("aria-modal", "true");
    } else {
      sidebar.removeAttribute("role");
      sidebar.removeAttribute("aria-modal");
    }
    if (main) main.inert = mobileOpen;
    if (mobileOpen) mobileClose.focus();
    else if (mobileQuery.matches && focusWasInSidebar) menuBtn.focus();
    menuBtn.setAttribute("aria-expanded", String(open));
    menuBtn.setAttribute("aria-label", open ? "关闭导航" : "打开导航");
    menuBtn.replaceChildren(icon(open ? "close" : "menu", 18));
  };
  mobileClose.addEventListener("click", () => setOpen(false));
  menuBtn.append(icon("menu", 18));
  menuBtn.addEventListener("click", () => setOpen(sidebar.dataset.open !== "true"));
  backdrop.addEventListener("click", () => setOpen(false));
  nav.addEventListener("click", (event) => {
    if ((event.target as HTMLElement).closest("a")) setOpen(false);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && sidebar.dataset.open === "true") {
      setOpen(false);
      return;
    }
    if (event.key !== "Tab" || !mobileQuery.matches || sidebar.dataset.open !== "true") return;
    const focusable = [...sidebar.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])')]
      .filter((node) => !node.hidden && node.getClientRects().length > 0);
    const first = focusable[0];
    const last = focusable.at(-1);
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });
  menuBtn.style.display = "none";
  const mobileQuery = matchMedia("(max-width: 900px)");
  const syncMenu = () => {
    menuBtn.style.display = mobileQuery.matches ? "" : "none";
    if (!mobileQuery.matches) setOpen(false);
  };
  syncMenu();
  mobileQuery.addEventListener("change", syncMenu);

  const title = el("div", { className: "topbar__title", textContent: "总览" });
  const asOf = el("div", { className: "topbar__asof", textContent: "" });
  const modeBadge = el("span", { className: "app-mode-badge app-mode-badge--topbar", textContent: appModeLabel(APP_MODE), title: APP_MODE === "demo" ? "显式演示模式 · 非真实账本" : "当前页面读取真实 API" });
  const personaSelect = el("select", { className: "demo-persona-select", "aria-label": "顶栏演示人物", title: "仅切换演示数据集，不是登录身份" }, [
    el("option", { value: "chen", textContent: "chen · 高净值" }),
    el("option", { value: "me", textContent: "me · 起步期" }),
  ]);
  if (APP_MODE !== "demo") personaSelect.hidden = true;
  const setDemoPersona = (persona: DemoPersona) => { personaSelect.value = persona; };
  if (APP_MODE === "demo") {
    setDemoPersona(readDemoPersona());
    personaSelect.addEventListener("change", () => {
      const params = new URLSearchParams(location.hash.split("?")[1]);
      params.set("demo_persona", readDemoPersona(undefined, personaSelect.value));
      location.hash = `${location.hash.split("?")[0]}?${params.toString()}`;
      writeDemoPersona(undefined, readDemoPersona(undefined, personaSelect.value));
    });
  }
  const search = el("input", { className: "topbar__search", type: "search", placeholder: "搜索交易、商户或备注", "aria-label": "搜索交易" });
  const submitSearch = () => {
    const q = search.value.trim();
    if (!q) return;
    const params = new URLSearchParams({ q });
    location.hash = `#/transactions?${params.toString()}`;
  };
  search.addEventListener("keydown", (event) => {
    if (event.key === "Enter") submitSearch();
  });
  const searchButton = el("button", { className: "icon-button", "aria-label": "搜索" });
  searchButton.append(icon("search", 17));
  searchButton.addEventListener("click", submitSearch);
  const topbar = el("header", { className: "topbar" }, [menuBtn, title, modeBadge, personaSelect, search, searchButton, el("div", { className: "topbar__spacer" }), asOf]);
  const content = el("main", { className: "content", id: "main-content" });
  main = el("div", { className: "main" }, [topbar, content]);
  sidebar.toggleAttribute("inert", mobileQuery.matches);
  root.append(el("div", { className: "shell" }, [sidebar, backdrop, main]));
  const shell = root.querySelector(".shell") as HTMLElement;
  const applyPreferences = () => {
    preferences = readUiPreferences();
    shell.dataset.collapsed = String(Boolean(preferences.collapsed));
    collapseButton.setAttribute("aria-label", preferences.collapsed ? "展开导航" : "折叠导航");
    collapseButton.setAttribute("aria-expanded", String(!preferences.collapsed));
    collapseButton.title = preferences.collapsed ? "展开导航" : "折叠导航";
    collapseButton.replaceChildren(icon(preferences.collapsed ? "chevron-right" : "chevron-left", 17));
    renderNav(nav, nav.dataset.current ?? "overview");
  };
  const setTheme = (theme: "light" | "dark") => {
    document.documentElement.dataset.theme = theme;
    document.dispatchEvent(new Event("wealthos:themechange"));
  };
  collapseButton.addEventListener("click", () => {
    writeUiPreferences({ ...readUiPreferences(), collapsed: !readUiPreferences().collapsed });
    applyPreferences();
  });
  applyPreferences();
  return { nav, title, asOf, content, sidebar, updatePreferences: applyPreferences, setTheme, setDemoPersona };
}

export function renderNav(nav: HTMLElement, current: string): void {
  nav.dataset.current = current;
  clear(nav);
  const preferences = readUiPreferences();
  const favorites = preferences.favorites ?? [];
  const groups = new Map<string, NavItem[]>();
  for (const item of NAV) {
    const list = groups.get(item.group) ?? [];
    list.push(item);
    groups.set(item.group, list);
  }
  for (const [group, items] of groups) {
    const wrap = el("div", { className: "nav-group" }, [el("div", { className: "nav-group__label", textContent: group === "总览" ? localeName("overview") : localizeText(group) })]);
    for (const item of items) {
      if (!(preferences.hidden ?? []).includes(item.page)) wrap.append(navLink(item, current, false));
    }
    nav.append(wrap);
  }
  if (favorites.length > 0) {
    const favoriteItems = NAV.filter((item) => item.p1 && favorites.includes(item.page) && !(preferences.hidden ?? []).includes(item.page));
    if (favoriteItems.length > 0) {
      const wrap = el("div", { className: "nav-group nav-group--favorites" }, [el("div", { className: "nav-group__label", textContent: "常用" })]);
      for (const item of favoriteItems) wrap.append(navLink(item, current, true));
      nav.prepend(wrap);
    }
  }
}

function navLink(item: NavItem, current: string, favoriteView: boolean): HTMLElement {
  const wrapper = el("div", { className: "nav-item-wrap", "data-favorite": String((readUiPreferences().favorites ?? []).includes(item.page)) });
  const a = el("a", {
    className: `nav-item${item.p1 ? "" : " nav-item--deferred"}`,
    href: `#/${item.page}`,
    title: localeName(item.page),
    ...(item.page === current ? { "aria-current": "page" } : {}),
  });
  a.append(icon(item.icon, 17), el("span", { className: "nav-item__label", textContent: localeName(item.page) }));
  if (!item.p1 && item.phase) a.append(el("span", { className: "nav-item__tag", textContent: item.phase }));
  const favorite = el("button", {
    className: "nav-item__favorite",
    "aria-label": `${wrapper.dataset.favorite === "true" ? "取消收藏" : "收藏"}${item.label}`,
    "aria-pressed": wrapper.dataset.favorite,
    title: wrapper.dataset.favorite === "true" ? "取消收藏" : "收藏",
  });
  favorite.textContent = "☆";
  favorite.dataset.active = wrapper.dataset.favorite;
  if (favoriteView) wrapper.dataset.favoriteView = "true";
  favorite.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    const currentPreferences = readUiPreferences();
    const existing = currentPreferences.favorites ?? [];
    const favorites = existing.includes(item.page) ? existing.filter((id) => id !== item.page) : [...existing, item.page];
    writeUiPreferences({ ...currentPreferences, favorites });
    renderNav(document.getElementById("main-nav") ?? document.querySelector(".sidebar__nav")!, current);
  });
  wrapper.append(a, favorite);
  return wrapper;
}
