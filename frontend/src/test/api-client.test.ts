import { describe, expect, it, vi } from "vitest";
import { ApiClient } from "@wealthos/api-client";

const envelope = { data: [], meta: { request_id: "test" } };

describe("typed read endpoints", () => {
  it("passes period and complete transaction filter scope to views", async () => {
    const fetchFn = vi.fn(async (_input: RequestInfo | URL) => new Response(JSON.stringify(envelope), { status: 200 }));
    const client = new ApiClient({ fetchFn: fetchFn as typeof fetch });
    await client.getView("income", { period: "2025-04" });
    await client.getView("transactions", { from: "2025-06-01", to: "2025-06-30", type: "INCOME", reconciliation: "MATCHED", data_state: "ACTUAL", q: "工资" });
    expect(fetchFn.mock.calls[0]?.[0]).toBe("/v1/views/income?period=2025-04");
    expect(fetchFn.mock.calls[1]?.[0]).toBe("/v1/views/transactions?from=2025-06-01&to=2025-06-30&type=INCOME&reconciliation=MATCHED&data_state=ACTUAL&q=%E5%B7%A5%E8%B5%84");
  });
  it("requests the complete catalog including runway", async () => {
    const fetchFn = vi.fn(async (_input: RequestInfo | URL) => new Response(JSON.stringify({ data: { metrics: [] }, meta: { request_id: "catalog" } }), { status: 200 }));
    await new ApiClient({ fetchFn: fetchFn as typeof fetch }).getMetrics();
    expect(String(fetchFn.mock.calls[0]?.[0])).toContain("financial_runway_months");
  });

  it("passes account scope and filters to cash flow", async () => {
    const fetchFn = vi.fn(async (_input: RequestInfo | URL) => new Response(JSON.stringify(envelope), { status: 200 }));
    await new ApiClient({ fetchFn: fetchFn as typeof fetch }).getCashFlow({ from: "2025-06-01", to: "2025-06-30", account_id: "account-1" });
    expect(String(fetchFn.mock.calls[0]?.[0])).toBe("/v1/reports/cash-flow?from=2025-06-01&to=2025-06-30&account_id=account-1");
  });
  it("preserves response metadata while normalizing a metric envelope", async () => {
    const meta = { request_id: "partial", data_state: "ESTIMATE", partial: true, missing_count: 2 };
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ data: { metrics: [] }, meta }), { status: 200 }));
    const client = new ApiClient({ fetchFn: fetchFn as typeof fetch });
    const response = await client.getMetrics({ ids: "total_assets" });
    expect(response.meta).toEqual(meta);
    expect(response.data.metrics).toEqual([]);
  });

  it("adds a demo persona only through an explicit demo adapter", async () => {
    const fetchFn = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify(envelope), { status: 200 }));
    const demo = new ApiClient({ fetchFn: fetchFn as typeof fetch, demoPersona: () => "me" });
    await demo.getMeta();
    expect(String(fetchFn.mock.calls[0]?.[0])).toContain("demo_persona=me");
    const ordinary = new ApiClient({ fetchFn: fetchFn as typeof fetch });
    await ordinary.getMeta();
    expect(String(fetchFn.mock.calls[1]?.[0])).not.toContain("demo_persona");
  });

  it("passes as_of and signal to asset valuations", async () => {
    const controller = new AbortController();
    const fetchFn = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify(envelope), { status: 200 }));
    const client = new ApiClient({ fetchFn: fetchFn as typeof fetch });
    await client.listAssetValuations("asset-1", { as_of: "2025-06-30" }, { signal: controller.signal });
    expect(fetchFn.mock.calls[0]?.[0]).toBe("/v1/assets/asset-1/valuations?as_of=2025-06-30");
    expect(fetchFn.mock.calls[0]?.[1]?.signal).toBe(controller.signal);
  });

  it("reads one metric with period and as_of", async () => {
    const fetchFn = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({ data: {}, meta: { request_id: "test" } }), { status: 200 }));
    const client = new ApiClient({ fetchFn: fetchFn as typeof fetch });
    await client.getMetric("net_worth", { period: "2025-06", as_of: "2025-06-30" });
    expect(fetchFn.mock.calls[0]?.[0]).toBe("/v1/metrics/net_worth?period=2025-06&as_of=2025-06-30");
  });

  it("passes the requested date range to financial snapshots", async () => {
    const controller = new AbortController();
    const fetchFn = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify(envelope), { status: 200 }));
    const client = new ApiClient({ fetchFn: fetchFn as typeof fetch });
    await client.listSnapshots({ from: "2025-01-01", to: "2025-06-30" }, { signal: controller.signal });
    expect(fetchFn.mock.calls[0]?.[0]).toBe("/v1/snapshots?from=2025-01-01&to=2025-06-30");
    expect(fetchFn.mock.calls[0]?.[1]?.signal).toBe(controller.signal);
  });
});

describe("transaction commands", () => {
  it("pairs without bootstrap headers and sends the in-memory CSRF token on every later POST", async () => {
    let token: string | undefined;
    const fetchFn = vi.fn(async (input: RequestInfo | URL) => new Response(JSON.stringify(String(input).includes("/auth/pair")
      ? { data: { paired: true, csrf_token: "test-csrf-token" }, meta: { request_id: "pair" } }
      : { data: {}, meta: { request_id: "command" } }), { status: 200 }));
    const client = new ApiClient({ fetchFn: fetchFn as typeof fetch, csrfToken: () => token });
    await client.getMeta();
    const paired = await client.pairSession("82736451");
    token = paired.data.csrf_token;
    await client.previewTransaction({ transaction_type: "EXPENSE", amount_cents: 100, currency: "CNY", transaction_date: "2025-07-01" });
    await client.createTransaction({ transaction_type: "EXPENSE", amount_cents: 100, transaction_date: "2025-07-01" }, "intent-1");
    await client.voidTransaction("transaction-1", { reason: "test" }, "void-1");
    const calls = fetchFn.mock.calls as unknown as [string, RequestInit][];
    expect(calls[0]![1].headers).not.toHaveProperty("X-CSRF-Token");
    expect(calls[1]![0]).toBe("/v1/auth/pair");
    expect(calls[1]![1].method).toBe("POST");
    expect(calls[1]![1].body).toBe(JSON.stringify({ code: "82736451" }));
    expect(calls[1]![1].headers).not.toHaveProperty("X-CSRF-Token");
    expect(calls[1]![1].headers).not.toHaveProperty("Idempotency-Key");
    for (const [url, init] of calls.slice(2)) {
      expect(init.method, url).toBe("POST");
      expect(init.headers, url).toMatchObject({ "X-CSRF-Token": "test-csrf-token" });
    }
  });

  it("notifies only recoverable session failures, never a wrong pair attempt", async () => {
    const onPairingRequired = vi.fn();
    const fetchFn = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const code = url.includes("/auth/pair") ? "PAIRING_WRONG" : url.includes("/transactions") ? "CSRF_REQUIRED" : "SESSION_INVALID";
      return new Response(JSON.stringify({ title: code, status: code === "CSRF_REQUIRED" ? 403 : 401, code, request_id: "test" }), { status: code === "CSRF_REQUIRED" ? 403 : 401 });
    });
    const client = new ApiClient({ fetchFn: fetchFn as typeof fetch, onPairingRequired });
    await expect(client.getMe()).rejects.toMatchObject({ problem: { code: "SESSION_INVALID" } });
    await expect(client.previewTransaction({ transaction_type: "EXPENSE", amount_cents: 100, currency: "CNY", transaction_date: "2025-07-01" })).rejects.toMatchObject({ problem: { code: "CSRF_REQUIRED" } });
    await expect(client.pairSession("wrong")).rejects.toMatchObject({ problem: { code: "PAIRING_WRONG" } });
    expect(onPairingRequired).toHaveBeenCalledTimes(2);
    expect(onPairingRequired.mock.calls.map(([problem]) => problem.code)).toEqual(["SESSION_INVALID", "CSRF_REQUIRED"]);
  });

  it("sends idempotent JSON commands without demo query parameters", async () => {
    const fetchFn = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({ data: { transaction_id: "transaction-1", replayed: false } }), { status: 201 }));
    const client = new ApiClient({ fetchFn: fetchFn as typeof fetch });
    await client.createTransaction({ transaction_type: "EXPENSE", amount_cents: 100, transaction_date: "2025-07-01" }, "intent-1");
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/v1/transactions");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({ "Idempotency-Key": "intent-1", "Content-Type": "application/json" });
  });

  it("previews without an idempotency key and voids with confirmation supplied by caller", async () => {
    const fetchFn = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({ data: {} }), { status: 200 }));
    const client = new ApiClient({ fetchFn: fetchFn as typeof fetch });
    await client.previewTransaction({ transaction_type: "EXPENSE", amount_cents: 100, currency: "CNY", transaction_date: "2025-07-01" });
    expect((fetchFn.mock.calls[0] as unknown as [string, RequestInit])[1].headers).not.toHaveProperty("Idempotency-Key");
    await client.voidTransaction("transaction-1", { reason: "录错了" }, "void-1");
    expect((fetchFn.mock.calls[1] as unknown as [string, RequestInit])[0]).toBe("/v1/transactions/transaction-1/void");
  });
});
