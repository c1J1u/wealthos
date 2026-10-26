import { describe, expect, it } from "vitest";
import { parseHash } from "./router";

describe("parseHash", () => {
  it("defaults to overview", () => {
    expect(parseHash("").page).toBe("overview");
    expect(parseHash("#/").page).toBe("overview");
  });

  it("preserves deep-link query state", () => {
    const route = parseHash("#/transactions?from=2025-06-01&type=INCOME&q=%E7%9B%92%E9%A9%AC&cursor=a%7Cb");
    expect(route.page).toBe("transactions");
    expect(route.params.get("type")).toBe("INCOME");
    expect(route.params.get("q")).toBe("盒马");
    expect(route.params.get("cursor")).toBe("a|b");
  });
});
