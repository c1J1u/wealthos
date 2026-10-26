import { describe, expect, it } from "vitest";
import { qualityCheckLabel, qualityMetadata } from "../domain/data-quality";

describe("data quality presentation", () => {
  it("keeps optional scalar fixture metadata without interpreting nested payloads", () => {
    expect(qualityMetadata({ persona: "chen", funding_legs_fixed: 23, verified: true, nested: { unsafe: "display" } })).toEqual([
      { key: "persona", value: "chen" }, { key: "funding_legs_fixed", value: "23" }, { key: "verified", value: "true" },
    ]);
    expect(qualityMetadata(null)).toEqual([]);
  });

  it("does not infer a boolean pass from legacy status text", () => {
    expect(qualityCheckLabel({ status: "INFO" })).toBe("INFO");
    expect(qualityCheckLabel({ pass: false })).toBe("关注");
    expect(qualityCheckLabel({ pass: true })).toBe("通过");
  });
});
