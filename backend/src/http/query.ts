/**
 * Strict query-parameter discipline (handoff §3.2/§4):
 * every documented parameter must work; anything else is a 400 — never a
 * silent 200 that ignores the caller's intent.
 */
import type { FastifyRequest } from "fastify";
import { ApiError } from "./envelope.js";

export function assertQuery(req: FastifyRequest, allowed: readonly string[]): void {
  const given = Object.keys(req.query as Record<string, unknown>);
  const offenders = given.filter((k) => !allowed.includes(k));
  if (offenders.length > 0) {
    throw new ApiError({
      status: 400,
      code: "UNSUPPORTED_PARAMETER",
      title: "Unsupported query parameter",
      detail: `unsupported: ${offenders.join(", ")}; allowed: ${allowed.join(", ")}`,
    });
  }
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export function parseDate(req: FastifyRequest, name: string): string | undefined {
  const raw = (req.query as Record<string, string | undefined>)[name];
  if (raw === undefined) return undefined;
  if (!DATE_RE.test(raw) || Number.isNaN(Date.parse(raw))) {
    throw new ApiError({
      status: 400,
      code: "INVALID_DATE",
      title: "Invalid date parameter",
      detail: `${name} must be YYYY-MM-DD, got: ${raw}`,
    });
  }
  return raw;
}

export function parseMonth(req: FastifyRequest, name: string): string | undefined {
  const raw = (req.query as Record<string, string | undefined>)[name];
  if (raw === undefined) return undefined;
  if (!MONTH_RE.test(raw)) {
    throw new ApiError({
      status: 400,
      code: "INVALID_PERIOD",
      title: "Invalid period parameter",
      detail: `${name} must be YYYY-MM, got: ${raw}`,
    });
  }
  return raw;
}

export function parseLimit(req: FastifyRequest): number {
  const raw = (req.query as Record<string, string | undefined>).limit;
  if (raw === undefined) return 50;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 200) {
    throw new ApiError({
      status: 400,
      code: "INVALID_LIMIT",
      title: "Invalid limit",
      detail: `limit must be an integer in [1,200], got: ${raw}`,
    });
  }
  return n;
}

/** true if the value is present and not "false"/"0". */
export function parseBool(req: FastifyRequest, name: string): boolean {
  const raw = (req.query as Record<string, string | undefined>)[name];
  if (raw === undefined) return false;
  if (!/^(true|false|0|1)$/.test(raw)) {
    throw new ApiError({
      status: 400,
      code: "INVALID_BOOLEAN",
      title: "Invalid boolean parameter",
      detail: `${name} must be true|false, got: ${raw}`,
    });
  }
  return raw === "true" || raw === "1";
}
