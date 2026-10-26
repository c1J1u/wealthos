/**
 * Deterministic UUIDv5 for fixture-derived entities.
 * Same input -> same UUID across runs, so golden tests can reference IDs
 * and re-imports replace cleanly instead of duplicating.
 */
import { createHash, randomUUID } from "node:crypto";

const NAMESPACE = "9f1d0f2a-3b4e-5f6a-8b9c-0d1e2f3a4b5c"; // WealthOS fixtures

function uuidV5(name: string): string {
  const hash = createHash("sha1")
    .update(NAMESPACE.replace(/-/g, ""), "hex")
    .update(name, "utf8")
    .digest();
  hash[6] = (hash[6]! & 0x0f) | 0x50; // version 5
  hash[8] = (hash[8]! & 0x3f) | 0x80; // variant
  const h = hash.toString("hex");
  return [
    h.slice(0, 8), h.slice(8, 12), h.slice(12, 16), h.slice(16, 20), h.slice(20, 32),
  ].join("-");
}

/** Stable UUID for a fixture entity, scoped to its persona book. */
export function fixtureId(persona: string, kind: string, key: string): string {
  return uuidV5(`${persona}:${kind}:${key}`);
}

export { randomUUID };
