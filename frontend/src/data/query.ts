// Memory-only server state: cache + request dedupe + stale-response guard.
// Financial responses never enter localStorage (PRD FR-SEC-02).
import type { ResponseMeta } from "@wealthos/api-client";

export type QueryStatus = "idle" | "loading" | "success" | "empty" | "partial" | "error";

export interface QueryError {
  message: string;
  code?: string;
  requestId?: string;
  status?: number;
}

export interface QueryState<T> {
  status: QueryStatus;
  data?: T;
  meta?: ResponseMeta;
  error?: QueryError;
}

interface CacheEntry<T> {
  data: T;
  meta?: ResponseMeta;
  storedAt: number;
}

export interface QueryOptions {
  ttlMs?: number;
  force?: boolean;
}

export function queryKey(parts: Record<string, unknown>): string {
  const normalized = Object.fromEntries(
    Object.entries(parts)
      .filter(([, value]) => value !== undefined && value !== null)
      .sort(([a], [b]) => a.localeCompare(b)),
  );
  return JSON.stringify(normalized);
}

export function normalizeQueryError(error: unknown): QueryError {
  const e = error as {
    message?: string;
    status?: number;
    problem?: { code?: string; request_id?: string };
  };
  return {
    message: e?.message ?? "请求失败，请稍后重试",
    code: e?.problem?.code,
    requestId: e?.problem?.request_id,
    status: e?.status,
  };
}

export class QueryClient {
  private generation = 0;
  private controllers = new Set<AbortController>();
  private cache = new Map<string, CacheEntry<unknown>>();
  private inFlight = new Map<string, { generation: number; promise: Promise<unknown> }>();

  nextGeneration(): number {
    this.generation += 1;
    for (const controller of this.controllers) controller.abort();
    this.controllers.clear();
    return this.generation;
  }

  isCurrent(generation: number): boolean {
    return generation === this.generation;
  }

  invalidate(predicate?: (key: string) => boolean): void {
    for (const key of this.cache.keys()) {
      if (!predicate || predicate(key)) this.cache.delete(key);
    }
  }

  clear(): void {
    this.cache.clear();
  }

  async run<T>(
    generation: number,
    key: string,
    request: (signal: AbortSignal) => Promise<T>,
    options: QueryOptions = {},
  ): Promise<QueryState<T>> {
    const ttl = options.ttlMs ?? 15_000;
    if (!this.isCurrent(generation)) return { status: "idle" };
    const cached = this.cache.get(key) as CacheEntry<T> | undefined;
    if (options.force) this.cache.delete(key);
    if (cached && !options.force && Date.now() - cached.storedAt < ttl) {
      return { status: this.statusOf(cached.data, cached.meta), data: cached.data, meta: cached.meta };
    }

    let pending = this.inFlight.get(key) as { generation: number; promise: Promise<QueryState<T>> } | undefined;
    if (!pending || pending.generation !== generation) {
      const controller = new AbortController();
      this.controllers.add(controller);
      const promise = request(controller.signal)
        .then((result): QueryState<T> => {
          const envelope = this.envelopeOf(result);
          // An aborted page may still resolve if its server ignores AbortSignal.
          // Never let that old response poison the shared cache.
          if (!controller.signal.aborted && this.isCurrent(generation)) {
            this.cache.set(key, { data: result, meta: envelope.meta, storedAt: Date.now() });
          }
          return { status: this.statusOf(result, envelope.meta), data: result, meta: envelope.meta };
        })
        .catch((error: unknown): QueryState<T> => ({ status: "error", error: normalizeQueryError(error) }));
      pending = { generation, promise };
      this.inFlight.set(key, pending);
      void promise.finally(() => {
        if (this.inFlight.get(key)?.promise === promise) this.inFlight.delete(key);
        this.controllers.delete(controller);
      });
    }

    const result = await pending.promise;
    if (!this.isCurrent(generation)) return { status: "idle" };
    return result;
  }

  private envelopeOf(value: unknown): { meta?: ResponseMeta } {
    if (typeof value !== "object" || value === null || !("meta" in value)) return {};
    return { meta: (value as { meta?: ResponseMeta }).meta };
  }

  private statusOf(value: unknown, meta?: ResponseMeta): QueryStatus {
    if (meta?.partial === true || (meta?.missing_count ?? 0) > 0) return "partial";
    const payload = typeof value === "object" && value !== null && "data" in value
      ? (value as { data: unknown }).data
      : value;
    if (Array.isArray(payload) && payload.length === 0) return "empty";
    return "success";
  }
}
