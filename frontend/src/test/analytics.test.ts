import { describe, expect, it } from "vitest";
import { chartKind, metricOptions, metricQuery, P1_METRIC_IDS } from "../domain/analytics";

describe("analytics view options", () => {
  it("uses the server catalog without inventing a metric", () => {
    expect(metricOptions([{ metric_id: "net_worth" }, { metric_id: "monthly_total_income" }] as never)).toEqual(["net_worth", "monthly_total_income"]);
  });

  it("restores chart and range from the URL", () => {
    const result = metricQuery(new URLSearchParams("metric=total_assets&range=12m&chart=bar"), "net_worth");
    expect(result).toEqual({ metric: "total_assets", range: "12m", chart: "bar" });
    expect(chartKind("unknown")).toBe("line");
  });

  it("does not replace an explicit metric missing from the server catalog", () => {
    const result = metricQuery(new URLSearchParams("metric=net_worth"), "monthly_total_income");
    expect(result.metric).toBe("net_worth");
    expect(P1_METRIC_IDS).toContain(result.metric);
    expect(metricQuery(new URLSearchParams("metric=unknown"), "monthly_total_income").metric).toBe("monthly_total_income");
    expect(metricOptions([{ metric_id: "not_a_p1_metric" }] as never)).toEqual([]);
  });

  it("includes runway in the selectable server metric catalog", () => {
    expect(metricOptions([{ metric_id: "financial_runway_months" }] as never)).toEqual(["financial_runway_months"]);
  });
});
