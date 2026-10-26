// View identity, not authentication. The server still owns the real session
// and book isolation; these fields only prevent mixing cached view data.
let activeBookId = "unresolved";
let schemaVersion = "unresolved";
let businessAsOf = "unresolved";
let bookPeriod = "unresolved";

export function defaultBusinessPeriod(meta: { book_period?: string; current_period: string }): string {
  return meta.book_period ?? meta.current_period;
}

export function setSessionContext(input: { bookId?: string; schemaVersion?: string; asOf?: string; bookPeriod?: string }): void {
  if (input.bookId !== undefined) activeBookId = input.bookId;
  if (input.schemaVersion !== undefined) schemaVersion = input.schemaVersion;
  if (input.asOf !== undefined) businessAsOf = input.asOf;
  if (input.bookPeriod !== undefined) bookPeriod = input.bookPeriod;
}

export function resetSessionContext(): void {
  activeBookId = "unresolved";
  schemaVersion = "unresolved";
  businessAsOf = "unresolved";
  bookPeriod = "unresolved";
}

export function sessionCacheKey(): Record<string, string> {
  return { book: activeBookId, schema: schemaVersion, asOf: businessAsOf, ...(bookPeriod === "unresolved" ? {} : { bookPeriod }) };
}

export function currentBookPeriod(): string { return bookPeriod; }

export function currentBookId(): string {
  return activeBookId;
}
