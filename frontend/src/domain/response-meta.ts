export function responseCompleteness(meta: { partial?: boolean; missing_count?: number } | undefined, metric?: { partial?: boolean; missing_count?: number }): { partial: boolean; missingCount?: number } {
  const missingCount = metric?.missing_count ?? meta?.missing_count;
  return { partial: metric?.partial === true || meta?.partial === true || (missingCount ?? 0) > 0, missingCount };
}
