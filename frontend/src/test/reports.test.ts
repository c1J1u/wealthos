import { describe, expect, it } from "vitest";
import { reportPeriodErrors } from "../domain/reports";

describe("report response contract", () => {
  it("rejects a current-period response for a historical query", () => {
    expect(reportPeriodErrors({ period: "2026-10" }, { period: "2025-06" })).toEqual(["期间"]);
    expect(reportPeriodErrors({ as_of: "2026-10-25" }, { asOf: "2025-06-30" })).toEqual(["as-of"]);
    expect(reportPeriodErrors({ from_date: "2026-10-01", to_date: "2026-10-31" }, { from: "2025-06-01", to: "2025-06-30" })).toEqual(["开始日期", "结束日期"]);
  });

  it("accepts an exact match", () => {
    expect(reportPeriodErrors({ period: "2025-06", as_of: "2025-06-30", from_date: "2025-06-01", to_date: "2025-06-30" },
      { period: "2025-06", asOf: "2025-06-30", from: "2025-06-01", to: "2025-06-30" })).toEqual([]);
  });
});
