import { describe, it, expect } from "vitest";
import { formatMoney, formatRatio, statusLabel, reconLabel, dataStateLabel, formatTimestamp, formatTransactionMoney } from "../presentation/format";

describe("formatMoney", () => {
  it("renders cents as yuan", () => {
    expect(formatMoney(18650)).toBe("¥186.50");
  });
  it("renders N/A for null", () => {
    expect(formatMoney(null)).toBe("N/A");
    expect(formatMoney(undefined)).toBe("N/A");
  });
  it("rejects unsafe integers instead of truncating", () => {
    expect(formatMoney(Number.MAX_SAFE_INTEGER + 1)).toBe("超出可显示范围");
  });
  it("handles negative", () => {
    expect(formatMoney(-5000)).toBe("-¥50.00");
  });
});

describe("formatRatio", () => {
  it("renders percent", () => {
    expect(formatRatio(0.810265)).toBe("81.0%");
  });
  it("renders N/A for null", () => {
    expect(formatRatio(null)).toBe("N/A");
  });
});

describe("formatTimestamp", () => {
  it("formats server timestamps in the business timezone and rejects invalid values", () => {
    expect(formatTimestamp("2025-06-15T16:00:00Z")).toBe("2025/06/16 00:00");
    expect(formatTimestamp("not-a-date")).toBe("N/A");
    expect(formatTimestamp(null)).toBe("N/A");
  });
});

describe("formatTransactionMoney", () => {
  it("uses textual signs and preserves neutral transfer amounts", () => {
    expect(formatTransactionMoney(1000, "income")).toBe("+¥10.00");
    expect(formatTransactionMoney(1000, "expense")).toBe("−¥10.00");
    expect(formatTransactionMoney(1000, "neutral")).toBe("¥10.00");
    expect(formatTransactionMoney(null, "income")).toBe("N/A");
  });
});

describe("labels", () => {
  it("localizes status", () => {
    expect(statusLabel("POSTED")).toBe("已入账");
    expect(statusLabel("VOIDED")).toBe("已作废");
  });
  it("localizes reconciliation", () => {
    expect(reconLabel("MATCHED")).toBe("已匹配");
  });
  it("localizes data state", () => {
    expect(dataStateLabel("ACTUAL")).toBe("实际");
    expect(dataStateLabel("ESTIMATE")).toBe("估算");
  });
});
