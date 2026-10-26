import { describe, expect, it, vi } from "vitest";
import { QueryClient, normalizeQueryError, queryKey } from "../data/query";

describe("queryKey", () => {
  it("normalizes ordering and drops absent values", () => {
    expect(queryKey({ b: 2, a: "x", c: undefined })).toBe('{"a":"x","b":2}');
  });
});

describe("QueryClient", () => {
  it("deduplicates concurrent requests and caches fresh results", async () => {
    const client = new QueryClient();
    const generation = client.nextGeneration();
    const request = vi.fn(async () => ({ data: [1], meta: { request_id: "r1" } }));
    const [a, b] = await Promise.all([client.run(generation, "a", request), client.run(generation, "a", request)]);
    const c = await client.run(generation, "a", request);
    expect(request).toHaveBeenCalledTimes(1);
    expect(a.data).toEqual(b.data);
    expect(c.meta?.request_id).toBe("r1");
  });

  it("refetches after ttl and invalidates matching cache entries", async () => {
    vi.useFakeTimers();
    const client = new QueryClient();
    const generation = client.nextGeneration();
    const request = vi.fn(async () => ({ data: [1] }));
    await client.run(generation, "book-a", request, { ttlMs: 20 });
    vi.advanceTimersByTime(21);
    await client.run(generation, "book-a", request, { ttlMs: 20 });
    await client.run(generation, "book-a", request);
    client.invalidate((key) => key.includes("book-a"));
    await client.run(generation, "book-a", request);
    expect(request).toHaveBeenCalledTimes(3);
    vi.useRealTimers();
  });

  it("forces a real request for a manual retry without clearing other cache entries", async () => {
    const client = new QueryClient();
    const generation = client.nextGeneration();
    const request = vi.fn(async () => ({ data: [1] }));
    const other = vi.fn(async () => ({ data: [2] }));
    await client.run(generation, "report", request);
    await client.run(generation, "other", other);
    await client.run(generation, "report", request, { force: true });
    await client.run(generation, "other", other);
    expect(request).toHaveBeenCalledTimes(2);
    expect(other).toHaveBeenCalledTimes(1);
  });

  it("marks empty and partial payloads", async () => {
    const client = new QueryClient();
    const generation = client.nextGeneration();
    expect((await client.run(generation, "empty", async () => [])).status).toBe("empty");
    expect((await client.run(generation, "partial", async () => ({ data: [1], meta: { request_id: "r", partial: true, missing_count: 2 } }))).status).toBe("partial");
  });

  it("does not commit stale generation results", async () => {
    const client = new QueryClient();
    const first = client.nextGeneration();
    const pending = client.run(first, "slow", async () => "old");
    client.nextGeneration();
    expect((await pending).status).toBe("idle");
  });

  it("aborts in-flight work on generation change", async () => {
    const client = new QueryClient();
    client.nextGeneration();
    const pending = client.run(1, "abort", (signal) => new Promise((_, reject) => {
      signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    }));
    client.nextGeneration();
    expect((await pending).status).toBe("idle");
  });

  it("does not cache aborted or stale responses", async () => {
    const client = new QueryClient();
    const first = client.nextGeneration();
    const request = vi.fn(async () => ({ data: [1] }));
    const pending = client.run(first, "shared", request);
    client.nextGeneration();
    const generation = client.nextGeneration();
    await client.run(generation, "shared", request);
    await client.run(generation, "shared", request);
    await pending;
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("does not serve cached data to a stale page generation", async () => {
    const client = new QueryClient();
    const first = client.nextGeneration();
    await client.run(first, "cached", async () => ({ data: [1] }));
    client.nextGeneration();
    expect((await client.run(first, "cached", async () => ({ data: [2] }))).status).toBe("idle");
  });

  it("does not deduplicate a stale in-flight request after generation change", async () => {
    const client = new QueryClient();
    const first = client.nextGeneration();
    const request = vi.fn(async () => ({ data: [] }));
    const pending = client.run(first, "same-key", request);
    const next = client.nextGeneration();
    const second = client.run(next, "same-key", request);
    await Promise.all([pending, second]);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("maps Problem errors without parsing display text", () => {
    expect(normalizeQueryError({ message: "no", status: 403, problem: { code: "FORBIDDEN", request_id: "r3" } })).toEqual({
      message: "no", status: 403, code: "FORBIDDEN", requestId: "r3",
    });
  });
});
