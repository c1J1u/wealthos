import { describe, expect, it } from "vitest";
import { appModeLabel, commandsEnabled, modeStageLabel, parseAppMode } from "../app/mode";
import { parseDemoPersona, readDemoPersona, writeDemoPersona } from "../app/demo-persona";

describe("application data mode", () => {
  it("requires an explicit demo opt-in and defaults safely to API", () => {
    expect(parseAppMode(undefined)).toBe("api");
    expect(parseAppMode("api")).toBe("api");
    expect(parseAppMode("demo")).toBe("demo");
    expect(parseAppMode("production")).toBe("api");
    expect(parseAppMode("true")).toBe("api");
  });

  it("keeps the demo explanation explicit and persistent", () => {
    expect(appModeLabel("demo")).toBe("演示数据");
    expect(appModeLabel("api")).toBe("真实 API");
  });

  it("enables production API commands by default with explicit read-only and demo lockout", () => {
    expect(commandsEnabled(undefined, "api")).toBe(true);
    expect(commandsEnabled("readonly", "api")).toBe(false);
    expect(commandsEnabled("readonly", "demo")).toBe(false);
    expect(commandsEnabled("enabled", "demo")).toBe(false);
    expect(commandsEnabled("enabled", "api")).toBe(true);
    expect(commandsEnabled(undefined, "demo")).toBe(false);
    expect(commandsEnabled("unexpected", "api")).toBe(true);
    expect(modeStageLabel(false)).toBe("只读模式");
    expect(modeStageLabel(true)).toBe("本地记账");
  });
});

describe("demo persona selection", () => {
  it("accepts only known demo datasets", () => {
    expect(parseDemoPersona(null)).toBe("chen");
    expect(parseDemoPersona("chen")).toBe("chen");
    expect(parseDemoPersona("me")).toBe("me");
    expect(parseDemoPersona("real-user")).toBe("chen");
  });

  it("stores only the demo dataset preference, not financial responses", () => {
    const values = new Map<string, string>();
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
    expect(readDemoPersona(storage, null)).toBe("chen");
    writeDemoPersona(storage, "me");
    expect(values.get("wealthos.demo.persona")).toBe("me");
    expect(readDemoPersona(storage, null)).toBe("me");
    expect(readDemoPersona(storage, "chen")).toBe("chen");
  });
});
