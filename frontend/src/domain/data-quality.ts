export interface QualityMetadataEntry { key: string; value: string }

export function qualityMetadata(value: unknown): QualityMetadataEntry[] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return [];
  return Object.entries(value).filter((entry): entry is [string, string | number | boolean] => ["string", "number", "boolean"].includes(typeof entry[1]))
    .map(([key, entry]) => ({ key, value: String(entry) }));
}

export function qualityCheckLabel(check: { pass?: boolean; status?: string }): string {
  if (typeof check.pass === "boolean") return check.pass ? "通过" : "关注";
  return check.status ?? "结果未知";
}
