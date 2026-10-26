import { describe, expect, it } from "vitest";
import { routeWithParams } from "../app/route-state";

describe("route state", () => {
  it("preserves view params while replacing period and invalidating pagination", () => {
    expect(routeWithParams("#/cashflow?period=2025-06&basis=per-account&cursor=old", { period: "2025-05" }, ["cursor"])).toBe("#/cashflow?period=2025-05&basis=per-account");
  });

  it("retains demo and unrelated view state without inventing an empty query", () => {
    expect(routeWithParams("#/income?period=2025-06&tab=settlement&demo_persona=me", { period: "2025-05" }, ["cursor"])).toBe("#/income?period=2025-05&tab=settlement&demo_persona=me");
    expect(routeWithParams("#/income", { period: "2025-05" }, ["cursor"])).toBe("#/income?period=2025-05");
  });

  it("does not treat the caller's current tab as a cashflow basis", () => {
    const hash = routeWithParams("#/cashflow?period=2025-06&basis=per-account", { period: "2025-05" }, ["cursor"]);
    expect(new URLSearchParams(hash.split("?")[1]).get("basis")).toBe("per-account");
    expect(new URLSearchParams(hash.split("?")[1]).has("tab")).toBe(false);
  });

  it("does not mutate the current URL while constructing a new view", () => {
    const original = "#/cashflow?period=2025-06&basis=per-account&cursor=one&cursor=two";
    const next = routeWithParams(original, { basis: "consolidated" }, ["cursor", "history"]);
    expect(next).toBe("#/cashflow?period=2025-06&basis=consolidated");
    expect(original).toContain("cursor=one&cursor=two");
  });
});
