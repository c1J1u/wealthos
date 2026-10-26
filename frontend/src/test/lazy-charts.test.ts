// @vitest-environment jsdom
import { beforeAll, describe, expect, it, vi } from "vitest";
import { barChart, donutChart, lineChart } from "../components/lazy-charts";

beforeAll(() => {
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
});

describe("lazy chart boundary", () => {
  it("loads the chart module only when a chart is requested", async () => {
    const chart = await lineChart([{ x: "2025-06", y: 100 }], { title: "测试" });
    expect(chart.className).toContain("chart-frame");
    const donut = await donutChart([{ name: "示例", value: 1 }]);
    expect(donut.querySelector("figcaption")).not.toBeNull();
    const bar = await barChart([{ name: "2025-06", value: 1 }]);
    expect(bar.querySelector(".chart-canvas")).not.toBeNull();
  });
});
