export function readPreference(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function readJsonPreference<T>(key: string, fallback: T, validate: (value: unknown) => value is T): T {
  const raw = readPreference(key);
  if (!raw) return fallback;
  try {
    const value: unknown = JSON.parse(raw);
    return validate(value) ? value : fallback;
  } catch {
    writePreference(key, JSON.stringify(fallback));
    return fallback;
  }
}

export function writePreference(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // UI preferences are optional. A restricted storage context must not
    // prevent the read-only application from loading.
  }
}

export function readTheme(): "light" | "dark" {
  return readPreference("wealthos.theme") === "light" ? "light" : "dark";
}

export function readLanguage(): "zh" | "en" {
  return readPreference("wealthos.lang") === "en" ? "en" : "zh";
}

export function isUiPreferences(value: unknown): value is { collapsed?: boolean; favorites?: string[]; hidden?: string[] } {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as { collapsed?: unknown; favorites?: unknown; hidden?: unknown };
  return (candidate.collapsed === undefined || typeof candidate.collapsed === "boolean")
    && (candidate.favorites === undefined || (Array.isArray(candidate.favorites) && candidate.favorites.every((item) => typeof item === "string")))
    && (candidate.hidden === undefined || (Array.isArray(candidate.hidden) && candidate.hidden.every((item) => typeof item === "string")));
}

export interface UiPreferences { collapsed?: boolean; favorites?: string[]; hidden?: string[] }

export function readUiPreferences(): UiPreferences {
  return readJsonPreference("wealthos.ui", {}, isUiPreferences);
}

export function writeUiPreferences(next: UiPreferences): void {
  writePreference("wealthos.ui", JSON.stringify(next));
}
