import { describe, expect, it } from "vitest";
import { historyRange, isDate, isPeriod, monthRange, recentMonthCutoff, validDateRange } from "../domain/period";

describe("period", () => {
  it("validates calendar months", () => {
    expect(isPeriod("2025-06")).toBe(true);
    expect(isPeriod("2025-13")).toBe(false);
    expect(isPeriod("2025-6")).toBe(false);
    expect(isPeriod("2025-06-15")).toBe(false);
    expect(isPeriod(undefined)).toBe(false);
    expect(isPeriod(null)).toBe(false);
  });

  it("returns exact month boundaries including leap years", () => {
    expect(monthRange("2025-06")).toEqual({ from: "2025-06-01", to: "2025-06-30" });
    expect(monthRange("2024-02")).toEqual({ from: "2024-02-01", to: "2024-02-29" });
    expect(monthRange("2025-02")).toEqual({ from: "2025-02-01", to: "2025-02-28" });
  });

  it("includes the current month in recent ranges and rejects invalid dates", () => {
    expect(recentMonthCutoff("2025-06-30", "1m")).toBe("2025-06-01");
    expect(recentMonthCutoff("2025-06-30", "3m")).toBe("2025-04-01");
    expect(recentMonthCutoff("2025-02-29", "1m")).toBeNull();
  });
});

describe("date filters", () => {
  it("rejects impossible or inverted ranges before querying", () => {
    expect(isDate("2025-02-29")).toBe(false);
    expect(isDate("2024-02-29")).toBe(true);
    expect(validDateRange("2025-07-01", "2025-06-30")).toBe(false);
    expect(validDateRange("2025-06-01", "2025-06-30")).toBe(true);
  });
});
  it("uses calendar boundaries without local timezone shifts", () => {
    expect(monthRange("2024-02")).toEqual({ from: "2024-02-01", to: "2024-02-29" });
    expect(isPeriod("2025-13")).toBe(false);
    expect(historyRange("3m", "2025-06-15")).toEqual({ from: "2025-04-01", to: "2025-06-30" });
    expect(historyRange("12m", "2025-06-15")).toEqual({ from: "2024-07-01", to: "2025-06-30" });
  });
