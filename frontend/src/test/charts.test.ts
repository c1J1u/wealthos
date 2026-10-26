// @vitest-environment jsdom
import { beforeAll, describe, expect, it, vi } from "vitest";
import { createBarChart, createDonutChart, createLineChart } from "../components/charts";

beforeAll(() => {
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
});

describe("accessible chart summaries", () => {
  it("describes actual returned line points without filling missing periods", () => {
    const chart = createLineChart(
      [{ x: "2025-03", y: 100 }, { x: "2025-06", y: 120 }],
      { title: "净资产", description: "缺失点保留，不补 0。", source: "/analytics/series", timeRange: "2025-01-01 至 2025-06-30", formatY: (value) => `¥${value}` },
      [{ x: "2025-03", y: 100 }, { x: "2025-04", y: null }, { x: "2025-05", y: null }, { x: "2025-06", y: 120 }],
    );
    expect(chart.querySelector("figcaption")?.textContent).toContain("/analytics/series");
    expect(chart.querySelector("figcaption")?.textContent).toContain("2025-01-01 至 2025-06-30");
    expect(chart.querySelector(".chart-summary")?.textContent).toContain("2 个有效点");
    expect(chart.querySelector(".chart-summary")?.textContent).toContain("2 个缺失点");
    expect(chart.querySelector(".chart-summary")?.textContent).toContain("2025-03 · ¥100");
    expect(chart.querySelector(".chart-summary")?.textContent).toContain("2025-06 · ¥120");
    expect(chart.querySelector(".chart-canvas")?.getAttribute("aria-label")).toContain("2 个缺失点");
  });

  it("exposes bar values and donut membership as text", () => {
    const bars = createBarChart([{ name: "2025-06", value: 30 }], { formatY: (value) => `${value}%` });
    expect(bars.querySelector(".chart-summary")?.textContent).toContain("2025-06 · 30%");
    const donut = createDonutChart([{ name: "沪深300ETF", value: 82400 }, { name: "国债", value: 12000 }], { source: "/positions" });
    expect(donut.querySelector(".chart-summary")?.textContent).toContain("沪深300ETF");
    expect(donut.querySelector("figcaption")?.textContent).toContain("/positions");
  });
});
