// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { el } from "../components/dom";
import { panel, setPanelBody } from "../components/page";
import { emptyState, skeleton } from "../components/states";
import { cashflowBasisUnavailable } from "../pages/cashflow-state";
import { valueMetricCard } from "../pages/page-primitives";
import { metricPartialBadge } from "../components/metric-state";

describe("panel loading state", () => {
  it("clears aria-busy when a terminal state replaces content", () => {
    const target = panel("数据", skeleton(100));
    expect(target.querySelector(".panel__body")?.getAttribute("aria-busy")).toBe("true");
    setPanelBody(target, emptyState("暂未提供", "等待服务端读模型"));
    expect(target.querySelector(".panel__body")?.getAttribute("aria-busy")).toBe("false");
    expect(target.textContent).toContain("暂未提供");
    setPanelBody(target, el("p", { textContent: "加载中" }));
    target.querySelector(".panel__body")?.setAttribute("aria-busy", "true");
    setPanelBody(target, el("p", { textContent: "完成" }));
    expect(target.querySelector(".panel__body")?.getAttribute("aria-busy")).toBe("false");
  });
});

describe("metric partial badge", () => {
  it("uses a single presentation for metric-level and response-level partial states", () => {
    const withMissing = metricPartialBadge({ partial: true, missing_count: 3 });
    const unknownMissing = metricPartialBadge({ partial: true, missing_count: 0 });
    expect(withMissing).not.toBe("");
    expect(unknownMissing).not.toBe("");
    if (withMissing) expect(withMissing.textContent).toBe("≈ 部分数据 · 缺失 3 项");
    if (unknownMissing) expect(unknownMissing.textContent).toBe("≈ 部分数据");
    expect(metricPartialBadge({ partial: false, missing_count: 0 })).toBe("");
  });
});

describe("partial metric presentation", () => {
  it("keeps the count alongside the approximation marker instead of merely calling data partial", () => {
    const card = valueMetricCard("净资产", "¥100.00", "ESTIMATE", "2025-06", { partial: true, missingCount: 3 });
    expect(card.textContent).toContain("≈");
    expect(card.textContent).toContain("缺失 3 项");
    expect(card.querySelector(".metric-card__partial")?.textContent).toBe("≈ 部分数据 · 缺失 3 项");
    expect(card.textContent).toContain("估算");
  });
});

describe("cashflow unavailable basis", () => {
  it("does not offer a retry for an unsupported account projection", () => {
    const node = cashflowBasisUnavailable();
    expect(node.textContent).toContain("account_id");
    expect(node.querySelector("button")?.textContent).toBe("查看合并现金流");
    expect(node.querySelector(".skeleton")).toBeNull();
  });
});
