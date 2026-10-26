import type { components, operations } from "./types.js";

export type { components, operations };
export type Schemas = components["schemas"];

export type Meta = Schemas["Meta"];
export type Me = Schemas["Me"];
export type Book = Schemas["Book"];
export type Account = Schemas["Account"];
export type AccountBalance = Schemas["AccountBalance"];
export type Transaction = Schemas["Transaction"];
export type TransactionEntry = Schemas["TransactionEntry"];
export type Category = Schemas["Category"];
export type Asset = Schemas["Asset"];
export type AssetValuation = Schemas["AssetValuation"];
export type Instrument = Schemas["Instrument"];
export type Position = Schemas["Position"];
export type Portfolio = Schemas["Portfolio"];
export type MetricResult = Schemas["MetricResult"];
export type MetricId = Schemas["MetricId"];
export type SeriesPoint = Schemas["SeriesPoint"];
export type BalanceSheetReport = Schemas["BalanceSheetReport"];
export type IncomeStatementReport = Schemas["IncomeStatementReport"];
export type CashFlowReport = Schemas["CashFlowReport"];
export type FinancialSnapshot = Schemas["FinancialSnapshot"];
export type ViewPayload = Schemas["ViewPayload"];
export type Phase1Page = Schemas["Phase1Page"];
export type ViewQuery = {
  as_of?: string; range?: string; period?: string;
  from?: string; to?: string; type?: string; account_id?: string; category_code?: string;
  status?: string; reconciliation?: string; data_state?: string; q?: string;
};
export type DataQualityReport = Schemas["DataQualityReport"];
export type Problem = Schemas["Problem"];
export type ResponseMeta = Schemas["ResponseMeta"];
export type DataState = Schemas["DataState"];
export type CreateTransactionRequest = Schemas["CreateTransactionRequest"];
export type TransactionPreviewRequest = Schemas["TransactionPreviewRequest"];
export type TransactionPreview = Schemas["TransactionPreview"];
export type CommandResult = Schemas["CommandResult"];

// The contract requires /metrics?ids=...; default to the complete P1 catalog
// unless a page explicitly requests a smaller bundle.
const ALL_METRIC_IDS = [
  "total_assets",
  "total_liabilities",
  "net_worth",
  "cash_reserve",
  "liquid_assets",
  "monthly_total_income",
  "monthly_total_expense",
  "essential_expense",
  "discretionary_expense",
  "financial_cost",
  "refund_reversal",
  "debt_service_to_income",
  "savings_rate",
  "savings_rate_incl_debt_principal",
  "net_worth_change",
  "financial_runway_months",
] as const satisfies readonly MetricId[];

export class ApiError extends Error {
  readonly status: number;
  readonly problem: Problem;

  constructor(status: number, problem: Problem) {
    super(problem.detail ?? problem.title);
    this.name = "ApiError";
    this.status = status;
    this.problem = problem;
  }
}

type Query = Record<string, string | number | boolean | undefined>;

function toQueryString(query?: Query): string {
  if (!query) return "";
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) params.set(key, String(value));
  }
  const s = params.toString();
  return s ? `?${s}` : "";
}

export interface ApiClientOptions {
  baseUrl?: string;
  fetchFn?: typeof fetch;
  /** Memory-backed CSRF provider; no token is persisted by this client. */
  csrfToken?: () => string | undefined;
  /** Pairing/session recovery is deliberately different from failed credentials. */
  onPairingRequired?: (problem: Problem) => void;
  /** Opt-in only for the local fixture adapter; never a real session switch. */
  demoPersona?: () => "chen" | "me";
}

/**
 * Thin typed client over the Phase 1 read-only API.
 * All requests share one entrypoint so session/book context, tracing and
 * Problem mapping stay centralized (PRD FR-DATA-01/07).
 */
export class ApiClient {
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;
  private readonly demoPersona?: () => "chen" | "me";
  private readonly csrfToken?: () => string | undefined;
  private readonly onPairingRequired?: (problem: Problem) => void;

  constructor(options: ApiClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? "/v1";
    this.fetchFn = options.fetchFn ?? fetch;
    this.demoPersona = options.demoPersona;
    this.csrfToken = options.csrfToken;
    this.onPairingRequired = options.onPairingRequired;
  }

  private async request<T>(
    path: string,
    opts: { query?: Query; signal?: AbortSignal; method?: string; body?: unknown; idempotencyKey?: string } = {},
  ): Promise<T> {
    // .call(window) keeps the native fetch receiver; a detached method
    // reference throws "Illegal invocation" in browsers.
    const demoQuery = this.demoPersona ? { demo_persona: this.demoPersona() } : {};
    const res = await this.fetchFn.call(undefined, `${this.baseUrl}${path}${toQueryString({ ...demoQuery, ...opts.query })}`, {
      signal: opts.signal ?? null,
      credentials: "same-origin",
      method: opts.method ?? "GET",
      headers: { Accept: "application/json", ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}), ...(opts.idempotencyKey ? { "Idempotency-Key": opts.idempotencyKey } : {}), ...(opts.method === "POST" && path !== "/auth/pair" && this.csrfToken?.() ? { "X-CSRF-Token": this.csrfToken()! } : {}) },
      ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
    });
    if (!res.ok) {
      let problem: Problem;
      try {
        problem = (await res.json()) as Problem;
      } catch {
        problem = {
          type: "about:blank",
          title: res.statusText || "Request failed",
          status: res.status,
          code: "INTERNAL",
          request_id: res.headers.get("x-request-id") ?? "unknown",
        };
      }
      if (path !== "/auth/pair" && ["PAIRING_REQUIRED", "SESSION_INVALID", "CSRF_REQUIRED"].includes(problem.code)) this.onPairingRequired?.(problem);
      throw new ApiError(res.status, problem);
    }
    return (await res.json()) as T;
  }

  getMeta(opts?: { signal?: AbortSignal }) {
    return this.request<{ data: Meta; meta: ResponseMeta }>("/meta", opts);
  }
  getMe(opts?: { signal?: AbortSignal }) {
    return this.request<{ data: Me; meta: ResponseMeta }>("/me", opts);
  }
  pairSession(code: string, opts?: { signal?: AbortSignal }) {
    return this.request<{ data: { paired: boolean; csrf_token: string; expires_in?: string }; meta?: ResponseMeta }>("/auth/pair", { ...opts, method: "POST", body: { code } });
  }
  listBooks(opts?: { signal?: AbortSignal }) {
    return this.request<{ data: Book[]; meta: ResponseMeta }>("/books", opts);
  }
  getView(page: Phase1Page, query?: ViewQuery, opts?: { signal?: AbortSignal }) {
    return this.request<{ data: ViewPayload; meta: ResponseMeta }>(`/views/${page}`, { ...opts, query });
  }
  listAccounts(query?: { as_of?: string; limit?: number; cursor?: string }, opts?: { signal?: AbortSignal }) {
    return this.request<{ data: Account[]; meta: ResponseMeta }>("/accounts", { ...opts, query });
  }
  listAccountEntries(accountId: string, query?: { from?: string; to?: string; limit?: number; cursor?: string }, opts?: { signal?: AbortSignal }) {
    return this.request<{ data: TransactionEntry[]; meta: ResponseMeta }>(`/accounts/${accountId}/entries`, { ...opts, query });
  }
  getAccountBalance(accountId: string, query?: { as_of?: string }, opts?: { signal?: AbortSignal }) {
    return this.request<{ data: AccountBalance; meta: ResponseMeta }>(`/accounts/${accountId}/balance`, { ...opts, query });
  }
  listTransactions(
    query?: {
      from?: string;
      to?: string;
      type?: string;
      account_id?: string;
      category_code?: string;
      q?: string;
      status?: string;
      reconciliation?: string;
      data_state?: string;
      limit?: number;
      cursor?: string;
    },
    opts?: { signal?: AbortSignal },
  ) {
    return this.request<{ data: Transaction[]; meta: ResponseMeta }>("/transactions", { ...opts, query });
  }
  createTransaction(body: CreateTransactionRequest, idempotencyKey: string, opts?: { signal?: AbortSignal }) {
    return this.request<{ data: CommandResult; meta?: ResponseMeta }>("/transactions", { ...opts, method: "POST", body, idempotencyKey });
  }
  previewTransaction(body: TransactionPreviewRequest, opts?: { signal?: AbortSignal }) {
    return this.request<{ data: TransactionPreview; meta?: ResponseMeta }>("/transactions/preview", { ...opts, method: "POST", body });
  }
  voidTransaction(id: string, body: { reason?: string; reversal_date?: string }, idempotencyKey: string, opts?: { signal?: AbortSignal }) {
    return this.request<{ data: CommandResult; meta?: ResponseMeta }>(`/transactions/${encodeURIComponent(id)}/void`, { ...opts, method: "POST", body, idempotencyKey });
  }
  getTransaction(id: string, opts?: { signal?: AbortSignal }) {
    return this.request<{ data: Transaction; meta: ResponseMeta }>(`/transactions/${id}`, opts);
  }
  listTransactionEntries(id: string, opts?: { signal?: AbortSignal }) {
    return this.request<{ data: TransactionEntry[]; meta: ResponseMeta }>(`/transactions/${id}/entries`, opts);
  }
  listCategories(query?: { kind?: string }, opts?: { signal?: AbortSignal }) {
    return this.request<{ data: Category[]; meta: ResponseMeta }>("/categories", { ...opts, query });
  }
  listAssets(opts?: { signal?: AbortSignal }) {
    return this.request<{ data: Asset[]; meta: ResponseMeta }>("/assets", opts);
  }
  listAssetValuations(assetId: string, query?: { as_of?: string }, opts?: { signal?: AbortSignal }) {
    return this.request<{ data: AssetValuation[]; meta: ResponseMeta }>(`/assets/${assetId}/valuations`, { ...opts, query });
  }
  listInstruments(opts?: { signal?: AbortSignal }) {
    return this.request<{ data: Instrument[]; meta: ResponseMeta }>("/instruments", opts);
  }
  listPositions(opts?: { signal?: AbortSignal }) {
    return this.request<{ data: Position[]; meta: ResponseMeta }>("/positions", opts);
  }
  getPortfolio(opts?: { signal?: AbortSignal }) {
    return this.request<{ data: Portfolio; meta: ResponseMeta }>("/portfolio", opts);
  }
  // The contract declares data: { metrics: [...] }, but the current backend
  // returns a bare array. Accept both so the frontend tracks the contract
  // regardless of which side the drift resolves toward (logged in DEVLOG).
  async getMetrics(query?: { as_of?: string; period?: string; ids?: string }, opts?: { signal?: AbortSignal }) {
    const res = await this.request<{ data: { metrics: MetricResult[] } | MetricResult[]; meta: ResponseMeta }>("/metrics", {
      ...opts,
      query: { ...query, ids: query?.ids ?? ALL_METRIC_IDS.join(",") },
    });
    const metrics = Array.isArray(res.data) ? res.data : res.data.metrics;
    return { data: { metrics }, meta: res.meta };
  }
  getSeries(
    query: { metric: MetricId; from?: string; to?: string; granularity?: string; data_state?: string },
    opts?: { signal?: AbortSignal },
  ) {
    return this.request<{ data: { metric_id: MetricId; granularity: string; points: SeriesPoint[] }; meta: ResponseMeta }>(
      "/analytics/series",
      { ...opts, query },
    );
  }
  getMetric(metricId: MetricId, query?: { as_of?: string; period?: string; data_state?: string }, opts?: { signal?: AbortSignal }) {
    return this.request<{ data: MetricResult; meta: ResponseMeta }>(`/metrics/${metricId}`, { ...opts, query });
  }
  getBalanceSheet(query?: { as_of?: string }, opts?: { signal?: AbortSignal }) {
    return this.request<{ data: BalanceSheetReport; meta: ResponseMeta }>("/reports/balance-sheet", { ...opts, query });
  }
  getIncomeStatement(query?: { period?: string }, opts?: { signal?: AbortSignal }) {
    return this.request<{ data: IncomeStatementReport; meta: ResponseMeta }>("/reports/income-statement", { ...opts, query });
  }
  getCashFlow(query?: { from?: string; to?: string; account_id?: string }, opts?: { signal?: AbortSignal }) {
    return this.request<{ data: CashFlowReport; meta: ResponseMeta }>("/reports/cash-flow", { ...opts, query });
  }
  listSnapshots(query?: { from?: string; to?: string }, opts?: { signal?: AbortSignal }) {
    return this.request<{ data: FinancialSnapshot[]; meta: ResponseMeta }>("/snapshots", { ...opts, query });
  }
  getDataQuality(opts?: { signal?: AbortSignal }) {
    return this.request<{ data: DataQualityReport; meta: ResponseMeta }>("/data-quality", opts);
  }
}
