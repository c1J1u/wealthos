import type { ApiClient } from "@wealthos/api-client";
import { defaultBusinessPeriod, setSessionContext } from "./session";
import { normalizeQueryError, type QueryError } from "../data/query";

export interface SessionUi {
  asOf: { textContent: string | null };
}

export class SessionBootstrap {
  private ready: Promise<boolean> | null = null;
  private controller: AbortController | null = null;
  private failure: QueryError | null = null;

  get error(): QueryError | null { return this.failure; }

  constructor(private readonly api: ApiClient, private readonly ui: SessionUi) {}

  async ensure(signal?: AbortSignal): Promise<boolean> {
    if (this.controller?.signal.aborted) this.ready = null;
    this.ready ??= this.initialize();
    const abort = () => this.controller?.abort();
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    let ready = false;
    try {
      ready = await this.ready;
    } finally {
      signal?.removeEventListener("abort", abort);
    }
    return ready && !signal?.aborted;
  }

  async reconnect(): Promise<boolean> {
    this.ready = null;
    const ready = await this.initialize();
    if (ready) this.failure = null;
    return ready;
  }

  reset(): void {
    this.controller?.abort();
    this.controller = null;
    this.ready = null;
  }

  private async initialize(): Promise<boolean> {
    this.controller = new AbortController();
    const controller = this.controller;
    const [metaResult, meResult] = await Promise.allSettled([
      this.api.getMeta({ signal: controller.signal }),
      this.api.getMe({ signal: controller.signal }),
    ]);
    if (controller.signal.aborted || this.controller !== controller) return false;
    const authError = [metaResult, meResult].find((result) => result.status === "rejected" && ["UNAUTHENTICATED", "PAIRING_REQUIRED", "SESSION_INVALID"].includes((result.reason as { problem?: { code?: string } })?.problem?.code ?? ""));
    if (authError?.status === "rejected") {
      this.failure = normalizeQueryError(authError.reason);
      this.ui.asOf.textContent = "会话已失效";
      return false;
    }
    const unavailable = [metaResult, meResult].find((result) => result.status === "rejected");
    if (unavailable?.status === "rejected") {
      const normalized = normalizeQueryError(unavailable.reason);
      this.failure = { ...normalized, code: normalized.code ?? "DATABASE_UNAVAILABLE" };
    } else this.failure = null;
    this.ui.asOf.textContent = metaResult.status === "fulfilled"
      ? `as of ${metaResult.value.data.today} · ${metaResult.value.data.timezone}`
      : "服务不可用";
    setSessionContext({
      bookId: meResult.status === "fulfilled" ? meResult.value.data.book_id : undefined,
      schemaVersion: metaResult.status === "fulfilled" ? metaResult.value.data.schema_version : undefined,
      asOf: metaResult.status === "fulfilled" ? metaResult.value.data.today : undefined,
      bookPeriod: metaResult.status === "fulfilled" && metaResult.value.data.current_period ? defaultBusinessPeriod(metaResult.value.data) : undefined,
    });
    return true;
  }
}
