import { describe, expect, it } from "vitest";
import { responseCompleteness } from "../domain/response-meta";

describe("response metadata", () => {
  it("keeps unknown missing counts distinct from zero", () => {
    expect(responseCompleteness({ partial: true })).toEqual({ partial: true, missingCount: undefined });
    expect(responseCompleteness({ partial: false, missing_count: 0 })).toEqual({ partial: false, missingCount: 0 });
    expect(responseCompleteness({ partial: false, missing_count: 2 })).toEqual({ partial: true, missingCount: 2 });
    expect(responseCompleteness({ partial: false, missing_count: 0 }, { partial: true, missing_count: 2 })).toEqual({ partial: true, missingCount: 2 });
    expect(responseCompleteness(undefined, { partial: true })).toEqual({ partial: true, missingCount: undefined });
  });
});
