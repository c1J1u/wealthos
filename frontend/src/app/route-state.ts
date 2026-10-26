export function routeWithParams(hash: string, updates: Record<string, string>, remove: readonly string[] = []): string {
  const [path, query = ""] = hash.split("?");
  const params = new URLSearchParams(query);
  for (const key of remove) params.delete(key);
  for (const [key, value] of Object.entries(updates)) params.set(key, value);
  const serialized = params.toString();
  return `${path}${serialized ? `?${serialized}` : ""}`;
}
