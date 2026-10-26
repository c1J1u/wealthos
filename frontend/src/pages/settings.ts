import type { DataQualityReport, Meta, Me } from "@wealthos/api-client";
import { api } from "../data/store";
import { normalizeQueryError } from "../data/query";
import { el } from "../components/dom";
import { errorState, skeleton } from "../components/states";
import { panel, setPanelBody } from "../components/page";
import { pageHeading, type PageContext } from "./flows";
import { NAV } from "../app/shell";
import { readLanguage, readTheme, readUiPreferences, writePreference, writeUiPreferences } from "../app/preferences";
import { disclosure } from "../components/disclosure";
import { formatTimestamp } from "../presentation/format";
import { qualityCheckLabel, qualityMetadata } from "../domain/data-quality";
import { APP_MODE, appModeLabel } from "../app/mode";
import { COMMANDS_ENABLED, modeStageLabel } from "../app/mode";
import { parseDemoPersona, readDemoPersona, writeDemoPersona, type DemoPersona } from "../app/demo-persona";
import { localeName, localizeText } from "../app/locale";

const QUALITY_LABELS: Record<string, string> = {
  "entries-balanced": "分录借贷平衡", "null-funding-legs": "缺失资金腿规范化", uncategorized: "未分类交易",
  unbalanced_transactions: "不平衡交易", negative_asset_balances: "资产账户负余额", estimate_transactions: "估算交易",
  positions_without_price: "缺少行情的持仓",
};

function qualityCheck(check: { check_id: string; pass?: boolean; status?: string; detail: string }): HTMLElement {
  return el("div", { className: "quality-row" }, [
    el("span", { className: check.pass === true ? "badge badge--actual" : check.pass === false ? "badge badge--estimate" : "badge badge--neutral", textContent: qualityCheckLabel(check) }),
    el("div", {}, [
      el("div", { textContent: QUALITY_LABELS[check.check_id] ?? check.check_id }),
      el("div", { className: "cell-muted", textContent: `${check.check_id} · ${check.detail}` }),
    ]),
  ]);
}

function normalizationDetails(value: unknown): HTMLElement[] {
  const entries = qualityMetadata(value);
  if (entries.length === 0) return [];
  return [disclosure("查看 fixtures 规范化元数据", el("dl", { className: "kv" }, entries.flatMap((entry) => [
    el("dt", { textContent: entry.key }), el("dd", { textContent: entry.value }),
  ])))];
}

interface SettingsContext extends PageContext {
  setTheme: (theme: "light" | "dark") => void;
  updatePreferences: () => void;
}

export async function renderSettings({ root, signal, setTheme, updatePreferences }: SettingsContext): Promise<void> {
  pageHeading(root, "设置", "当前系统状态可信吗");
  const systemPanel = panel("系统信息", skeleton(140));
  const qualityPanel = panel("数据质量", skeleton(140));
  const preferencesPanel = panel("显示偏好", el("div"));
  const navigationPanel = panel("导航模块", el("div"));
  const demoPanel = APP_MODE === "demo" ? panel("演示数据集", el("div")) : null;
  root.append(el("div", { className: "grid-2" }, [systemPanel, qualityPanel]), preferencesPanel, navigationPanel);
  preferencesPanel.style.marginTop = "1rem";
  navigationPanel.style.marginTop = "1rem";
  if (demoPanel) {
    const personaSelect = el("select", { "aria-label": "设置演示人物", value: readDemoPersona() }, [
      el("option", { value: "chen", textContent: "chen · 高净值" }),
      el("option", { value: "me", textContent: "me · 起步期" }),
    ]);
    personaSelect.value = readDemoPersona();
    personaSelect.addEventListener("change", () => {
      const persona: DemoPersona = parseDemoPersona(personaSelect.value);
      const params = new URLSearchParams(location.hash.split("?")[1]);
      params.set("demo_persona", persona);
      location.hash = `#/settings?${params.toString()}`;
    });
    setPanelBody(demoPanel, el("div", { className: "preference-row" }, [
      el("div", {}, [el("div", { textContent: "人物数据集" }), el("div", { className: "cell-muted", textContent: "仅切换合成演示数据，不是登录身份；不会接触真实账本。" })]),
      personaSelect,
    ]));
    root.insertBefore(demoPanel, preferencesPanel);
  }

  const loadSystem = async () => {
    setPanelBody(systemPanel, skeleton(140));
    try {
      const [metaRes, meRes, booksRes] = await Promise.all([api.getMeta({ signal }), api.getMe({ signal }), api.listBooks({ signal })]);
      if (signal.aborted) return;
      const meta: Meta = metaRes.data;
      const me: Me = meRes.data;
      const book = booksRes.data.find((item) => item.book_id === me.book_id);
      setPanelBody(systemPanel, el("dl", { className: "kv" }, [
        el("dt", { textContent: "用户" }), el("dd", { textContent: me.display_name }),
        el("dt", { textContent: "账本" }), el("dd", { textContent: me.book_name }),
        el("dt", { textContent: "账本 ID" }), el("dd", { textContent: me.book_id }),
        el("dt", { textContent: "币种 / 状态" }), el("dd", { textContent: book ? `${book.base_currency} · ${book.status}` : "N/A · 服务端未返回当前账本" }),
        el("dt", { textContent: "财政起始月" }), el("dd", { textContent: book?.fiscal_start_month == null ? "N/A" : `${book.fiscal_start_month} 月` }),
        el("dt", { textContent: "Schema" }), el("dd", { textContent: meta.schema_version }),
        el("dt", { textContent: "服务器时间" }), el("dd", { textContent: meta.server_time }),
        el("dt", { textContent: "时区" }), el("dd", { textContent: meta.timezone }),
        el("dt", { textContent: "业务日期" }), el("dd", { textContent: meta.today }),
        el("dt", { textContent: "数据位置" }), el("dd", { textContent: "当前服务账本（由后端配置）" }),
        el("dt", { textContent: "模式" }), el("dd", { textContent: `${appModeLabel(APP_MODE)} · ${modeStageLabel(COMMANDS_ENABLED)} · 单账本` }),
      ]));
    } catch (error) {
      if (!signal.aborted) setPanelBody(systemPanel, errorState(normalizeQueryError(error), loadSystem));
    }
  };

  const loadQuality = async () => {
    setPanelBody(qualityPanel, skeleton(140));
    try {
      const res = await api.getDataQuality({ signal });
      if (signal.aborted) return;
      const quality: DataQualityReport = res.data;
      const legacy = quality as unknown as { generated_at?: string };
      const legacyChecks = (quality.checks ?? []) as { check_id: string; pass?: boolean; status?: string; detail: string }[];
      const attention = legacyChecks.filter((check) => check.pass === false || (check.pass === undefined && check.status !== "PASS"));
      const metadata = normalizationDetails(quality.fixture_normalization);
      if (!Array.isArray(quality.checks) || quality.checks.some((check) => typeof check.pass !== "boolean")) {
        setPanelBody(qualityPanel, el("div", { className: "stack" }, [
          errorState({ message: "响应缺少 pass 字段；以下保留原始检查，不推断通过或失败。" }, loadQuality),
          legacy.generated_at ? el("div", { className: "cell-muted", textContent: `原始检查时间 ${formatTimestamp(legacy.generated_at)} · 字段待按契约对齐` }) : "",
          ...[...attention, ...legacyChecks.filter((check) => !attention.includes(check))].map(qualityCheck),
          ...metadata,
        ]));
        return;
      }
      setPanelBody(qualityPanel, el("div", { className: "stack" }, [
        el("div", { className: "cell-muted", textContent: `检查时间 ${formatTimestamp(quality.run_at)} · ${quality.pass ? "全部通过" : `存在 ${attention.length} 项关注`}` }),
        ...[...attention, ...legacyChecks.filter((check) => !attention.includes(check))].map(qualityCheck),
        ...metadata,
      ]));
    } catch (error) {
      if (!signal.aborted) setPanelBody(qualityPanel, errorState(normalizeQueryError(error), loadQuality));
    }
  };

  const themeButton = el("button", { className: "button", textContent: readTheme() === "light" ? "切换到深色主题" : "切换到浅色主题" });
  themeButton.addEventListener("click", () => {
    const next = readTheme() === "light" ? "dark" : "light";
    writePreference("wealthos.theme", next);
    setTheme(next);
    themeButton.textContent = next === "light" ? "切换到深色主题" : "切换到浅色主题";
  });
  setPanelBody(preferencesPanel, el("div", { className: "preference-row" }, [
    el("div", {}, [el("div", { textContent: "外观" }), el("div", { className: "cell-muted", textContent: "图表随主题同步，刷新后保留。" })]),
    themeButton,
  ]));

  const languageSelect = el("select", { "aria-label": "界面语言", "data-language": "interface", value: readLanguage() }, [
    el("option", { value: "zh", textContent: "简体中文" }),
    el("option", { value: "en", textContent: "English" }),
  ]);
  languageSelect.value = readLanguage();
  languageSelect.addEventListener("change", () => {
    writePreference("wealthos.lang", languageSelect.value);
    document.dispatchEvent(new Event("wealthos:localechange"));
  });
  preferencesPanel.append(el("div", { className: "preference-row" }, [
    el("div", {}, [
      el("div", { textContent: "语言" }),
      el("div", { className: "cell-muted", textContent: "选择界面语言，立即更新固定文案；财务数据、API 代码与原始诊断保持不变。" }),
    ]),
    languageSelect,
  ]));

  const toggles = el("div", { className: "preference-list" });
  for (const item of NAV.filter((item) => item.p1 && item.page !== "settings")) {
    const checkbox = el("input", {
      type: "checkbox",
      "aria-label": `在导航中显示${item.label}`,
      ...(readUiPreferences().hidden?.includes(item.page) ? {} : { checked: true }),
    });
    checkbox.addEventListener("change", () => {
      const current = readUiPreferences();
      const hidden = new Set(current.hidden ?? []);
      if (checkbox.checked) hidden.delete(item.page); else hidden.add(item.page);
      writeUiPreferences({ ...current, hidden: [...hidden] });
      updatePreferences();
    });
    toggles.append(el("label", { className: "preference-toggle" }, [
      checkbox, el("span", { textContent: localeName(item.page) }), el("span", { className: "cell-muted", textContent: item.group === "总览" ? localeName("overview") : localizeText(item.group) }),
    ]));
  }
  const collapseButton = el("button", {
    className: "button",
    textContent: readUiPreferences().collapsed ? "展开桌面导航" : "折叠桌面导航",
    "aria-expanded": String(!readUiPreferences().collapsed),
    "aria-controls": "main-nav",
  });
  collapseButton.addEventListener("click", () => {
    const current = readUiPreferences();
    writeUiPreferences({ ...current, collapsed: !current.collapsed });
    updatePreferences();
    collapseButton.textContent = readUiPreferences().collapsed ? "展开桌面导航" : "折叠桌面导航";
    collapseButton.setAttribute("aria-expanded", String(!readUiPreferences().collapsed));
  });
  setPanelBody(navigationPanel, el("div", { className: "stack" }, [
    el("div", { className: "cell-muted", textContent: "只调整导航入口，不影响数据权限、路由或财务事实。" }),
    collapseButton, toggles,
  ]));
  await Promise.all([loadSystem(), loadQuality()]);
}
