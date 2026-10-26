/**
 * Contract response envelope: { data, meta } and Problem errors.
 * ResponseMeta: request_id, as_of, data_state, partial, missing_count,
 * next_cursor, version (OpenAPI components/schemas/ResponseMeta).
 */
import { randomUUID } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";

export interface ResponseMeta {
  request_id: string;
  as_of?: string;
  period?: string;
  data_state?: "ACTUAL" | "ESTIMATE";
  partial?: boolean;
  missing_count?: number;
  next_cursor?: string | null;
  version?: number;
}

export function ok<T>(data: T, meta: Omit<ResponseMeta, "request_id"> = {}): { data: T; meta: ResponseMeta } {
  return { data, meta: { request_id: randomUUID(), ...meta } };
}

export interface ProblemInit {
  status: number;
  code: string;
  title: string;
  detail?: string;
}

export class ApiError extends Error {
  constructor(public readonly init: ProblemInit) {
    super(init.title);
    this.name = "ApiError";
  }
}

export function problemReply(req: FastifyRequest, reply: FastifyReply, init: ProblemInit) {
  reply.code(init.status).send({
    type: "about:blank",
    title: init.title,
    status: init.status,
    code: init.code,
    request_id: randomUUID(),
    ...(init.detail ? { detail: init.detail } : {}),
  });
}

export const errors = {
  unauthorized: () => new ApiError({ status: 401, code: "UNAUTHENTICATED", title: "Authentication required" }),
  forbidden: () => new ApiError({ status: 403, code: "FORBIDDEN", title: "Not allowed" }),
  notFound: (what = "Resource") => new ApiError({ status: 404, code: "NOT_FOUND", title: `${what} not found` }),
  badRequest: (code: string, detail: string) => new ApiError({ status: 400, code, title: "Bad request", detail }),
  unavailable: () => new ApiError({ status: 503, code: "DATABASE_UNAVAILABLE", title: "Database unavailable" }),
};

/** Cursor pagination over a stable sort key. */
export function paginate<T>(items: T[], limit: number, cursorOf: (t: T) => string): { page: T[]; next_cursor: string | null } {
  const page = items.slice(0, limit);
  const next = items.length > limit ? cursorOf(page[page.length - 1]!) : null;
  return { page, next_cursor: next };
}
