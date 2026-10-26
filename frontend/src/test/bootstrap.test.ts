import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "@wealthos/api-client";
import { SessionBootstrap } from "../app/bootstrap";
import { sessionCacheKey } from "../app/session";
import { defaultBusinessPeriod } from "../app/session";

function response(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

describe("SessionBootstrap", () => {
  it("uses book_period rather than real today or current_period for business defaults", () => {
    expect(defaultBusinessPeriod({ current_period: "2026-10", book_period: "2025-06" })).toBe("2025-06");
    expect(defaultBusinessPeriod({ current_period: "2026-10" })).toBe("2026-10");
  });
  afterEach(() => vi.useRealTimers());

  it("initializes once and exposes book/schema context for cache keys", async () => {
    const fetchFn = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path.endsWith("/meta")) return response({ data: { today: "2025-06-15", timezone: "Asia/Shanghai", schema_version: "1.0" } });
      if (path.endsWith("/me")) return response({ data: { book_id: "book-a" } });
      throw new Error(path);
    });
    const ui = { asOf: { textContent: "" } };
    const bootstrap = new SessionBootstrap(new ApiClient({ fetchFn: fetchFn as typeof fetch }), ui);
    await Promise.all([bootstrap.ensure(), bootstrap.ensure()]);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(ui.asOf.textContent).toContain("2025-06-15");
    expect(sessionCacheKey()).toEqual({ book: "book-a", schema: "1.0", asOf: "2025-06-15" });
  });

  it("does not block on failed session metadata", async () => {
    const fetchFn = vi.fn(async () => {
      throw new Error("offline");
    });
    const ui = { asOf: { textContent: "" } };
    const bootstrap = new SessionBootstrap(new ApiClient({ fetchFn: fetchFn as typeof fetch }), ui);
    await expect(bootstrap.ensure()).resolves.toBe(true);
    expect(ui.asOf.textContent).toBe("服务不可用");
  });

  it("requires explicit reconnect after session expiry and resumes the current page", async () => {
    let expired = true;
    const calls: string[] = [];
    const fetchFn = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      calls.push(path);
      if (path === "/v1/me" && expired) return new Response(JSON.stringify({ type: "about:blank", title: "Session expired", status: 401, code: "UNAUTHENTICATED", request_id: "auth-1" }), { status: 401 });
      if (path === "/v1/me") return response({ data: { book_id: "book-a" } });
      if (path === "/v1/meta") return response({ data: { today: "2025-06-15", timezone: "Asia/Shanghai", schema_version: "1.0" } });
      throw new Error(path);
    });
    const ui = { asOf: { textContent: "" } };
    const bootstrap = new SessionBootstrap(new ApiClient({ fetchFn: fetchFn as typeof fetch }), ui);
    await expect(bootstrap.ensure()).resolves.toBe(false);
    expect(bootstrap.error?.code).toBe("UNAUTHENTICATED");
    expired = false;
    await expect(bootstrap.reconnect()).resolves.toBe(true);
    expect(bootstrap.error).toBeNull();
    expect(calls.filter((path) => path === "/v1/me")).toHaveLength(2);
    expect(sessionCacheKey().book).toBe("book-a");
  });

  it("does not treat a transient bootstrap network error as session expiry", async () => {
    const fetchFn = vi.fn(async () => { throw new Error("offline"); });
    const bootstrap = new SessionBootstrap(new ApiClient({ fetchFn: fetchFn as typeof fetch }), { asOf: { textContent: "" } });
    await expect(bootstrap.ensure()).resolves.toBe(true);
    expect(bootstrap.error?.code).toBe("DATABASE_UNAVAILABLE");
  });

  it("reconnects after a database outage and clears stale failure state", async () => {
    let unavailable = true;
    const fetchFn = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === "/v1/meta" && unavailable) {
        return new Response(JSON.stringify({ type: "about:blank", title: "Database unavailable", status: 503, code: "DATABASE_UNAVAILABLE", request_id: "db-1" }), { status: 503 });
      }
      return response({ data: String(input) === "/v1/me" ? { book_id: "book-a" } : { today: "2025-06-15", timezone: "Asia/Shanghai", schema_version: "1.0" } });
    });
    const ui = { asOf: { textContent: "" } };
    const bootstrap = new SessionBootstrap(new ApiClient({ fetchFn: fetchFn as typeof fetch }), ui);
    await expect(bootstrap.ensure()).resolves.toBe(true);
    expect(bootstrap.error?.code).toBe("DATABASE_UNAVAILABLE");
    unavailable = false;
    await expect(bootstrap.reconnect()).resolves.toBe(true);
    expect(bootstrap.error).toBeNull();
    expect(ui.asOf.textContent).toContain("2025-06-15");
    expect(sessionCacheKey().book).toBe("book-a");
  });

  it("requires authentication again if metadata recovers but identity is still expired", async () => {
    let offline = true;
    const fetchFn = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === "/v1/me") {
        return new Response(JSON.stringify({ type: "about:blank", title: "Session expired", status: 401, code: offline ? "DATABASE_UNAVAILABLE" : "UNAUTHENTICATED", request_id: "session-2" }), { status: offline ? 503 : 401 });
      }
      return response({ data: { today: "2025-06-15", timezone: "Asia/Shanghai", schema_version: "1.0" } });
    });
    const ui = { asOf: { textContent: "" } };
    const bootstrap = new SessionBootstrap(new ApiClient({ fetchFn: fetchFn as typeof fetch }), ui);
    await expect(bootstrap.ensure()).resolves.toBe(true);
    expect(bootstrap.error?.code).toBe("DATABASE_UNAVAILABLE");
    offline = false;
    await expect(bootstrap.reconnect()).resolves.toBe(false);
    expect(bootstrap.error?.code).toBe("UNAUTHENTICATED");
    expect(ui.asOf.textContent).toBe("会话已失效");
  });

  it.each(["PAIRING_REQUIRED", "SESSION_INVALID"])("stops for recoverable %s instead of reporting a database outage", async (code) => {
    const fetchFn = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === "/v1/me") return new Response(JSON.stringify({ title: code, status: 401, code, request_id: "pairing-test" }), { status: 401 });
      return response({ data: { today: "2025-06-15", timezone: "Asia/Shanghai", schema_version: "1.0" } });
    });
    const bootstrap = new SessionBootstrap(new ApiClient({ fetchFn: fetchFn as typeof fetch }), { asOf: { textContent: "" } });
    await expect(bootstrap.ensure()).resolves.toBe(false);
    expect(bootstrap.error?.code).toBe(code);
    expect(bootstrap.error?.requestId).toBe("pairing-test");
  });

  it("does not resume an aborted navigation with stale session data", async () => {
    vi.useFakeTimers();
    const fetchFn = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return response({ data: {} });
    });
    const ui = { asOf: { textContent: "" } };
    const bootstrap = new SessionBootstrap(new ApiClient({ fetchFn: fetchFn as typeof fetch }), ui);
    const controller = new AbortController();
    const ready = bootstrap.ensure(controller.signal);
    controller.abort();
    await vi.advanceTimersByTimeAsync(20);
    await expect(ready).resolves.toBe(false);
    expect(ui.asOf.textContent).toBe("");
  });

  it("does not commit session data after reset during in-flight initialization", async () => {
    vi.useFakeTimers();
    const fetchFn = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return response({ data: {} });
    });
    const ui = { asOf: { textContent: "" } };
    const bootstrap = new SessionBootstrap(new ApiClient({ fetchFn: fetchFn as typeof fetch }), ui);
    const ready = bootstrap.ensure();
    bootstrap.reset();
    await vi.advanceTimersByTimeAsync(20);
    await expect(ready).resolves.toBe(false);
    expect(ui.asOf.textContent).toBe("");
  });
});
