import { describe, expect, it } from "vitest";
import { seriesContractErrors } from "../domain/series";
import { getMetricSeries } from "../data/series";
import { comparisonLabel } from "../domain/series";

describe("series contract validation", () => {
  it("detects a server replacing a historical request with the current month", () => {
    expect(seriesContractErrors({
      metric_id: "monthly_total_income", granularity: "month",
      points: [{ period: "2026-10", value_cents: 0, value: null }],
    }, { metric: "monthly_total_income", granularity: "month", from: "2025-01-01", to: "2025-06-30" }))
      .toContain("请求期间");
  });

  it("accepts null points in range and rejects mismatched metric ids", () => {
    expect(seriesContractErrors({
      metric_id: "net_worth", granularity: "month",
      points: [{ period: "2025-06", value_cents: null, value: null }],
    }, { metric: "net_worth", granularity: "month", from: "2025-01-01", to: "2025-06-30" })).toEqual([]);
    expect(seriesContractErrors({
      metric_id: "total_assets", granularity: "month", points: [],
    }, { metric: "net_worth", granularity: "month" })).toContain("指标");
  });

  it("rejects malformed point dates, unsafe money, invalid data states and duplicate months", () => {
    const query = { metric: "monthly_total_income", granularity: "month", from: "2025-01-01", to: "2025-06-30" };
    expect(seriesContractErrors({ metric_id: "monthly_total_income", granularity: "month", points: [{ period: "2025-02-30", value_cents: 0, value: null }] }, query)).toContain("数据点期间");
    expect(seriesContractErrors({ metric_id: "monthly_total_income", granularity: "month", points: [{ period: "2025-06", value_cents: Number.MAX_SAFE_INTEGER + 1, value: null }] }, query)).toContain("金额");
    expect(seriesContractErrors({ metric_id: "monthly_total_income", granularity: "month", points: [{ period: "2025-06", value_cents: 0, value: null, data_state: "UNKNOWN" }] }, query)).toContain("数据态");
    expect(seriesContractErrors({ metric_id: "monthly_total_income", granularity: "month", points: [{ period: "2025-06", value_cents: 0, value: null }, { period: "2025-06", value_cents: 1, value: null }] }, query)).toContain("重复期间");
  });
});

describe("series request", () => {
  it("rejects the response before a chart can display the wrong period", async () => {
    const client = { getSeries: async () => ({ data: {
      metric_id: "monthly_total_income", granularity: "month", points: [{ period: "2026-10", value_cents: 0, value: null }],
    } }) };
    await expect(getMetricSeries(client, { metric: "monthly_total_income", from: "2025-01-01", to: "2025-06-30", granularity: "month" }))
      .rejects.toMatchObject({ message: expect.stringContaining("请求期间") });
  });
});

describe("series comparison projection", () => {
  it("formats CNY change as a relative rate, preserving explicit null reasons", () => {
    expect(comparisonLabel({ value: 0.125, reference_period: "2025-05" }, "CNY")).toBe("+12.5% · 2025-05");
    expect(comparisonLabel({ value: null, na_reason: "zero_reference" }, "CNY")).toBe("N/A · zero_reference");
  });

  it("uses ratio and month deltas in the metric unit, not percentages", () => {
    expect(comparisonLabel({ value: 0.02 }, "RATIO")).toBe("+2.0pp");
    expect(comparisonLabel({ value: -1.5 }, "MONTHS")).toBe("-1.5 个月");
  });

  it("rejects unsafe comparison amounts and non-finite comparison rates", () => {
    expect(seriesContractErrors({ metric_id: "net_worth", granularity: "month", points: [{ period: "2025-06", value: null, mom: { value_cents: Number.MAX_SAFE_INTEGER + 1 } }] }, { metric: "net_worth" })).toContain("比较金额");
    expect(seriesContractErrors({ metric_id: "savings_rate", granularity: "month", points: [{ period: "2025-06", value: null, yoy: { value: Number.POSITIVE_INFINITY } }] }, { metric: "savings_rate" })).toContain("比较比率");
  });
});
