import type { MetricResult } from "@wealthos/api-client";
import { describe, expect, it } from "vitest";
import { getMetricBundle, MetricContractError, metricBundle, normalizeMetric } from "../data/metrics";
import { metricContractErrors } from "../domain/metrics";

function rawMetric(overrides: Record<string, unknown> = {}): MetricResult {
  return {
    metric_id: "net_worth", metric_version: "1", metric_name: "净资产", unit: "CNY",
    value_cents: 100, value: null, data_state: "ACTUAL", partial: false, missing_count: 0,
    ...overrides,
  } as MetricResult;
}

describe("metric DTO validation", () => {
  it("rejects unsafe money and values of the wrong unit", () => {
    expect(normalizeMetric(rawMetric({ value_cents: Number.MAX_SAFE_INTEGER + 1 }))).toBeNull();
    expect(normalizeMetric(rawMetric({ value_cents: 1.5 }))).toBeNull();
    expect(normalizeMetric(rawMetric({ unit: "RATIO", value: 100 }))).toBeNull();
    expect(normalizeMetric(rawMetric({ unit: "RATIO", value_cents: null, value: 0.2 }))?.value).toBe(0.2);
  });

  it("honors requested ids without inventing missing metrics", () => {
    const result = metricBundle([
      rawMetric(),
      rawMetric({ metric_id: "monthly_total_income", value_cents: 200 }),
      rawMetric({ metric_id: "debt_principal_repay", value_cents: 300 }),
    ], ["net_worth", "total_assets"]);
    expect(result.metrics.map((m) => m.metric_id)).toEqual(["net_worth"]);
    expect(result.missingIds).toEqual(["total_assets"]);
    expect(result.ignoredIds).toEqual(["monthly_total_income", "debt_principal_repay"]);
  });

  it("preserves explicit null instead of converting it to zero", () => {
    expect(normalizeMetric(rawMetric({ value_cents: null, na_reason: "no_snapshot" }))?.value_cents).toBeNull();
    expect(metricBundle({ metrics: [] }, ["net_worth"]).missingIds).toEqual(["net_worth"]);
  });

  it("accepts MONTHS and COUNT as scalar values, never as cents", () => {
    expect(normalizeMetric(rawMetric({ unit: "MONTHS", value_cents: null, value: 6.4 }))?.value).toBe(6.4);
    expect(normalizeMetric(rawMetric({ unit: "COUNT", value_cents: null, value: 2 }))?.value).toBe(2);
    expect(normalizeMetric(rawMetric({ unit: "CNY", value: 6.4 }))).toBeNull();
  });

  it("rejects incomplete bundles and missing state metadata instead of calling them complete", () => {
    const { partial, ...missingPartial } = rawMetric();
    expect(normalizeMetric(missingPartial)).toBeNull();
    expect(normalizeMetric(rawMetric({ data_state: undefined }))).toBeNull();
    expect(normalizeMetric(rawMetric({ missing_count: -1 }))).toBeNull();
    expect(() => metricBundle(null, ["net_worth"])).toThrow("指标响应格式不正确");
    expect(() => metricBundle({ unexpected: [] }, ["net_worth"])).toThrow("指标响应格式不正确");
  });

  it("does not silently discard invalid requested metrics", () => {
    const { data_state, ...invalidState } = rawMetric();
    const result = metricBundle([invalidState], ["net_worth"]);
    expect(result.metrics).toEqual([]);
    expect(result.invalidIds).toEqual(["net_worth"]);
    expect(result.missingIds).toEqual([]);
  });

  it("rejects a flow metric from a different requested period", () => {
    expect(metricContractErrors(rawMetric({ metric_id: "monthly_total_income", period: "2026-10" }), { period: "2025-06" })).toEqual(["期间"]);
    expect(metricContractErrors(rawMetric({ period: null, as_of: "2025-06-30" }), { period: "2025-06" })).toEqual([]);
  });

  it("rejects mismatched stock as-of instead of accepting a different snapshot", () => {
    expect(metricContractErrors(rawMetric({ as_of: "2026-10-25" }), { as_of: "2025-06-30" })).toEqual(["as-of"]);
  });
});

describe("metric request", () => {
  it("rejects unexpected ids when the server ignores the requested filter", async () => {
    const client = {
      getMetrics: async () => ({ data: [rawMetric(), rawMetric({ metric_id: "debt_principal_repay" })] }),
    };
    await expect(getMetricBundle(client, ["total_assets", "net_worth"], { period: "2025-06" })).rejects.toMatchObject({ message: expect.stringContaining("ids") });
    await expect(getMetricBundle(client, ["total_assets", "net_worth"], { period: "2025-06" })).rejects.toBeInstanceOf(MetricContractError);
  });

  it("rejects the whole requested bundle rather than displaying a wrong month", async () => {
    const client = { getMetrics: async () => ({ data: [rawMetric({ metric_id: "monthly_total_income", period: "2026-10" })] }) };
    await expect(getMetricBundle(client, ["monthly_total_income"], { period: "2025-06" })).rejects.toBeInstanceOf(MetricContractError);
  });
});
