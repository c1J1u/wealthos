// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { errorState, partialState } from "../components/states";

describe("recoverable error states", () => {
  it("does not retry authentication automatically, but offers an explicit reconnect", () => {
    let reconnects = 0;
    const state = errorState(
      { message: "Session expired", status: 401, code: "UNAUTHENTICATED", requestId: "auth-1" },
      () => { reconnects += 1; },
      { onReconnect: () => { reconnects += 1; } },
    );
    expect(state.textContent).toContain("会话已失效");
    expect(state.textContent).toContain("重新连接");
    expect(state.querySelectorAll("button")).toHaveLength(1);
    (state.querySelector("button") as HTMLButtonElement).click();
    expect(reconnects).toBe(1);
  });

  it("does not present a retry for forbidden or missing resources", () => {
    const forbidden = errorState({ message: "No scope", status: 403, code: "FORBIDDEN" }, () => {});
    const missing = errorState({ message: "Missing asset", status: 404, code: "NOT_FOUND" }, () => {});
    expect(forbidden.textContent).toContain("没有访问权限");
    expect(forbidden.querySelector("button")).toBeNull();
    expect(missing.textContent).toContain("数据不存在");
    expect(missing.querySelector("button")).toBeNull();
  });

  it("provides a safe return action for a missing resource", () => {
    let returns = 0;
    const state = errorState(
      { message: "Missing", status: 404, code: "NOT_FOUND" },
      undefined,
      { onReturn: () => { returns += 1; } },
    );
    (state.querySelector("button") as HTMLButtonElement).click();
    expect(returns).toBe(1);
  });

  it("distinguishes validation, version conflict and database recovery paths", () => {
    const validation = errorState({ message: "Bad date range", status: 422, code: "VALIDATION_FAILED" }, () => {});
    expect(validation.textContent).toContain("请求参数有误");
    expect(validation.textContent).toContain("请修正查询条件");
    expect(validation.querySelector("button")).toBeNull();
    let reloads = 0;
    const conflict = errorState({ message: "Book version changed", status: 409, code: "VERSION_CONFLICT" }, () => { reloads += 1; });
    expect(conflict.textContent).toContain("版本冲突");
    expect(conflict.querySelector("button")?.textContent).toBe("重新读取");
    (conflict.querySelector("button") as HTMLButtonElement).click();
    expect(reloads).toBe(1);
    const unavailable = errorState({ message: "Offline", status: 503, code: "DATABASE_UNAVAILABLE" }, () => {});
    expect(unavailable.querySelector("button")?.textContent).toBe("重试");
  });
});

describe("partial response metadata", () => {
  it("announces affected count even when the count is unknown", () => {
    expect(partialState(2, "指标目录").textContent).toBe("≈部分数据 · 缺失 2 项 · 指标目录");
    expect(partialState(0, "快照").textContent).toBe("≈部分数据 · 快照");
  });
});
