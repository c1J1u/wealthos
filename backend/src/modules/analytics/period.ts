/**
 * Period semantics (user decision U-2, 2026-10-25):
 * the default period for a book is the latest month containing posted
 * transactions; a book without transactions falls back to the current
 * calendar month. /meta.today always reports real server time.
 */
import type { PoolClient } from "pg";

export async function defaultPeriod(client: PoolClient, bookId: string): Promise<string> {
  const r = await client.query<{ m: string | null }>(
    `SELECT to_char(max(transaction_date), 'YYYY-MM') AS m
       FROM transactions
      WHERE book_id = $1::uuid AND status IN ('POSTED','RECONCILED')`,
    [bookId],
  );
  return r.rows[0]?.m ?? new Date().toISOString().slice(0, 7);
}

export function monthEnd(month: string): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y!, m! - 1 + 1, 0)); // last day of month
  return d.toISOString().slice(0, 10);
}

export function monthStart(month: string): string {
  return `${month}-01`;
}

export function addMonths(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y!, m! - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
}

/** All months between from..to (inclusive), clamped by caller. */
export function monthsBetween(fromMonth: string, toMonth: string): string[] {
  const out: string[] = [];
  let cur = fromMonth;
  let guard = 0;
  while (cur <= toMonth && guard < 1200) {
    out.push(cur);
    cur = addMonths(cur, 1);
    guard++;
  }
  return out;
}

export function dayToMonth(day: string): string {
  return day.slice(0, 7);
}
