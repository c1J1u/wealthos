export function reportPeriodErrors(
  report: { period?: string; as_of?: string; from_date?: string; to_date?: string },
  query: { period?: string; asOf?: string; from?: string; to?: string },
): string[] {
  const errors: string[] = [];
  if (query.period && report.period !== query.period) errors.push("期间");
  if (query.asOf && report.as_of !== query.asOf) errors.push("as-of");
  if (query.from && report.from_date !== query.from) errors.push("开始日期");
  if (query.to && report.to_date !== query.to) errors.push("结束日期");
  return errors;
}
