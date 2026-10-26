// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { currentLocale, dataText, localeName, localizeText, translateLocale } from "../app/locale";
import { el } from "../components/dom";

afterEach(() => { vi.unstubAllGlobals(); translateLocale("zh"); });

describe("complete UI locale", () => {
  it("translates fixed UI copy but preserves financial codes and dynamic evidence", () => {
    translateLocale("en");
    expect(localizeText("记一笔")).toBe("New transaction");
    expect(localizeText("本地服务 · 单账本")).toBe("Local service · one book");
    expect(localizeText("对账 UNRECONCILED")).toBe("Reconciliation UNRECONCILED");
    expect(localizeText("账户 de7a0625-e3f4-5501-b7d8-2d1943411bf0")).toBe("Account de7a0625-e3f4-5501-b7d8-2d1943411bf0");
    expect(localizeText("招商银行 · 活期")).toBe("招商银行 · 活期");
    expect(localizeText("code=PERIOD_CLOSED request_id=abc")).toBe("code=PERIOD_CLOSED request_id=abc");
    expect(localizeText("资产重估")).toBe("Asset revaluation");
    expect(localizeText("Live API · Local bookkeeping · 单账本")).toBe("Live API · Local bookkeeping · one book");
    expect(localizeText("P3 接入 · 尚未接入")).toBe("P3 · Not connected");
    expect(localizeText("中信证券 · 证券账户")).toBe("中信证券 · 证券账户");
    expect(localizeText("住房按揭 · 资产重估")).toBe("住房按揭 · 资产重估");
    expect(localizeText("月收入趋势 · 缺失点不补 0。 来源：/analytics/series · 期间：2025-01-01 至 2025-06-30"))
      .toBe("Monthly income trend · missing points are not zero-filled. Source: /analytics/series · Period: 2025-01-01 to 2025-06-30");
    expect(localizeText("非受限 · 实际")).toBe("Unrestricted · Actual");
    expect(localizeText("数据态 实际 · request abc")).toBe("Data state Actual · request abc");
    expect(localizeText("配对此设备")).toBe("Pair this device");
    expect(localizeText("配对并继续")).toBe("Pair and continue");
  });

  it("localizes DOM text and attributes without changing input values or URLs", () => {
    translateLocale("en");
    const input = el("input", { placeholder: "搜索商户或备注", value: "盒马" });
    const link = el("a", { href: "#/transactions?q=%E7%9B%92%E9%A9%AC" }, ["流水"]);
    const button = el("button", { "aria-label": "重试" }, ["关闭"]);
    document.body.append(input, link, button);
    expect(input.placeholder).toBe("Search merchant or note");
    expect(input.value).toBe("盒马");
    expect(link.textContent).toBe("Transactions");
    expect(link.getAttribute("href")).toBe("#/transactions?q=%E7%9B%92%E9%A9%AC");
    expect(button.textContent).toBe("Close");
    expect(button.getAttribute("aria-label")).toBe("Retry");
    input.remove(); link.remove(); button.remove();
  });

  it("uses explicit English names and falls back to Chinese safely", () => {
    translateLocale("en");
    expect(localeName("overview")).toBe("Overview");
    expect(localeName("transactions")).toBe("Transactions");
    expect(localeName("settings")).toBe("Settings");
    expect(currentLocale()).toBe("en");
    translateLocale("zh");
    expect(localeName("overview")).toBe("总览");
  });

  it("restores fixed UI copy without altering input or dynamic financial data", () => {
    translateLocale("en");
    const button = el("button", { "aria-label": "重试" }, ["加载失败"]);
    const input = el("input", { placeholder: "搜索商户或备注", value: "盒马" });
    const account = el("span", { textContent: "招商银行 · 活期" });
    document.body.append(button, input, account);
    translateLocale("en");
    expect(button.textContent).toBe("Load failed");
    expect(account.textContent).toBe("招商银行 · 活期");
    translateLocale("zh");
    expect(button.textContent).toBe("加载失败");
    expect(button.getAttribute("aria-label")).toBe("重试");
    expect(input.placeholder).toBe("搜索商户或备注");
    expect(input.value).toBe("盒马");
    expect(account.textContent).toBe("招商银行 · 活期");
    button.remove(); input.remove(); account.remove();
  });

  it("preserves raw API nodes in both languages", () => {
    const name = el("span", {}, [dataText("现金钱包")]);
    document.body.append(name);
    translateLocale("en");
    expect(name.textContent).toBe("现金钱包");
    translateLocale("zh");
    expect(name.textContent).toBe("现金钱包");
    name.remove();
  });
});
