const PERIOD_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

export function isPeriod(value: string | null | undefined): value is string {
  return typeof value === "string" && PERIOD_PATTERN.test(value);
}

export function monthRange(period: string): { from: string; to: string } | null {
  if (!isPeriod(period)) return null;
  const year = Number(period.slice(0, 4));
  const month = Number(period.slice(5, 7));
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { from: `${period}-01`, to: `${period}-${String(lastDay).padStart(2, "0")}` };
}

export function historyRange(range: string, asOf: string): { from: string; to: string } | null {
  if (!["1m", "3m", "6m", "12m"].includes(range) || !/^\d{4}-\d{2}-\d{2}$/.test(asOf)) return null;
  const year = Number(asOf.slice(0, 4));
  const month = Number(asOf.slice(5, 7));
  const start = new Date(Date.UTC(year, month - Number(range.slice(0, -1)), 1));
  return { from: start.toISOString().slice(0, 10), to: monthRange(asOf.slice(0, 7))!.to };
}

export function recentMonthCutoff(asOf: string, range: string): string | null {
  if (!isDate(asOf)) return null;
  return historyRange(range, asOf)?.from ?? null;
}

export function isDate(value: string | null | undefined): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function validDateRange(from?: string, to?: string): boolean {
  return (!from || isDate(from)) && (!to || isDate(to)) && (!from || !to || from <= to);
}
