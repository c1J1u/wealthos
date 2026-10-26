import type { MetricResult } from "@wealthos/api-client";
import { metricBundle, metricContractErrors } from "../domain/metrics";

export type { MetricResult };
export { metricBundle, normalizeMetric } from "../domain/metrics";

export class MetricContractError extends Error {
  readonly problem = { code: "INVALID_RESPONSE", request_id: undefined };
  constructor(readonly reasons: string[]) {
    super(`服务端指标与请求不一致（${reasons.join("、")}）；为避免展示错误指标或期间，已停止显示这些指标。`);
  }
}

interface MetricsClient {
  getMetrics(query?: { as_of?: string; period?: string; ids?: string }, opts?: { signal?: AbortSignal }): Promise<unknown>;
}

export async function getMetricBundle(
  client: MetricsClient,
  ids?: readonly string[],
  query: { as_of?: string; period?: string } = {},
  opts?: { signal?: AbortSignal },
) {
  const res = await client.getMetrics({ ...query, ids: ids?.join(",") }, opts) as {
    data: unknown;
    meta?: { request_id: string; partial?: boolean; missing_count?: number; as_of?: string };
  };
  const result = metricBundle(res.data, ids);
  const reasons = [...new Set([
    ...(result.ignoredIds.length > 0 ? [`ids（未请求 ${result.ignoredIds.join("、")}）`] : []),
    ...(result.invalidIds.length > 0 ? [`响应字段不完整或无效（${result.invalidIds.join("、")}）`] : []),
    ...result.metrics.flatMap((metric) => metricContractErrors(metric, query)),
  ])];
  if (reasons.length > 0) throw new MetricContractError(reasons);
  return { ...result, meta: res.meta };
}
