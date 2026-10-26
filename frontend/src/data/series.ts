import type { MetricId, SeriesPoint } from "@wealthos/api-client";
import { seriesContractErrors, type SeriesQuery } from "../domain/series";

export class SeriesContractError extends Error {
  readonly problem = { code: "INVALID_RESPONSE", request_id: undefined };
  constructor(readonly reasons: string[]) {
    super(`服务端序列与请求不一致（${reasons.join("、")}）；为避免展示错误期间，已停止绘制。`);
  }
}

interface SeriesClient {
  getSeries(query: { metric: MetricId; from?: string; to?: string; granularity?: string; data_state?: string }, opts?: { signal?: AbortSignal }): Promise<unknown>;
}

export async function getMetricSeries(client: SeriesClient, query: SeriesQuery, opts?: { signal?: AbortSignal }) {
  const res = await client.getSeries({ ...query, metric: query.metric as MetricId }, opts) as {
    data: { metric_id: string; granularity: string; points: SeriesPoint[] };
    meta?: { request_id: string; partial?: boolean; missing_count?: number; as_of?: string };
  };
  const reasons = seriesContractErrors(res.data, query);
  if (reasons.length > 0) throw new SeriesContractError(reasons);
  return res;
}
