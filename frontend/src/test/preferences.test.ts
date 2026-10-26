import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isUiPreferences, readJsonPreference, readLanguage, readTheme, writePreference } from "../app/preferences";

describe("preferences", () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => { store.set(key, value); },
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  it("uses defaults for absent or invalid theme/language", () => {
    expect(readTheme()).toBe("dark");
    expect(readLanguage()).toBe("zh");
    writePreference("wealthos.theme", "invalid");
    writePreference("wealthos.lang", "invalid");
    expect(readTheme()).toBe("dark");
    expect(readLanguage()).toBe("zh");
  });

  it("repairs malformed JSON preferences instead of throwing", () => {
    writePreference("wealthos.ui", "{broken");
    expect(readJsonPreference("wealthos.ui", {}, isUiPreferences)).toEqual({});
    expect(readJsonPreference("wealthos.ui", { collapsed: true }, isUiPreferences)).toEqual({});
    writePreference("wealthos.ui", JSON.stringify({ favorites: ["overview"] }));
    expect(readJsonPreference("wealthos.ui", {}, isUiPreferences)).toEqual({ favorites: ["overview"] });
  });

  it("does not block the application when storage is restricted", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => { throw new Error("denied"); },
      setItem: () => { throw new Error("denied"); },
    });
    expect(readTheme()).toBe("dark");
    expect(() => writePreference("wealthos.theme", "light")).not.toThrow();
  });
});
