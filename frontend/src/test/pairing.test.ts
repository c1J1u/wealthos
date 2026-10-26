// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PairingController } from "../app/pairing";
import { translateLocale } from "../app/locale";

function shell(): void {
  document.body.replaceChildren();
  const root = document.createElement("div");
  root.id = "app";
  document.body.append(root);
}

function response(code: string, requestId = "pairing-request") {
  return Promise.reject({ status: 401, message: code, problem: { code, request_id: requestId } });
}

let storage: Map<string, string>;
beforeEach(() => {
  storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    get length() { return storage.size; },
    key: (index: number) => [...storage.keys()][index] ?? null,
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => { storage.set(key, value); },
    removeItem: (key: string) => { storage.delete(key); },
    clear: () => { storage.clear(); },
  });
});
afterEach(() => { document.body.replaceChildren(); vi.unstubAllGlobals(); translateLocale("zh"); });

describe("device pairing", () => {
  it("pairs once, stores only the in-memory CSRF token and resumes the route", async () => {
    shell();
    localStorage.setItem("wealthos.lang", "en");
    location.hash = "#/transactions?period=2025-06";
    const pairSession = vi.fn(async () => ({ data: { paired: true, csrf_token: "csrf-test-only" }, meta: { request_id: "pair" } }));
    const onPaired = vi.fn(async () => {});
    const pairing = new PairingController({ pairSession }, onPaired);
    pairing.open();
    const input = document.querySelector<HTMLInputElement>('input[aria-label="配对码"]')!;
    input.value = "82736451";
    document.querySelector<HTMLFormElement>("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(onPaired).toHaveBeenCalledOnce());
    expect(pairSession).toHaveBeenCalledWith("82736451", expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(pairing.getCsrfToken()).toBe("csrf-test-only");
    expect(document.querySelector(".drawer")).toBeNull();
    expect(location.hash).toBe("#/transactions?period=2025-06");
    expect(localStorage.getItem("wealthos.lang")).toBe("en");
    expect([...Array(localStorage.length)].map((_, index) => localStorage.key(index))).toEqual(["wealthos.lang"]);
    expect(document.querySelector('input[aria-label="配对码"]')).toBeNull();
  });

  it("keeps wrong/expired code errors in the open dialog and never opens a second request loop", async () => {
    shell();
    const pairSession = vi.fn()
      .mockImplementationOnce(() => response("PAIRING_WRONG", "wrong-1"))
      .mockImplementationOnce(() => response("PAIRING_EXPIRED", "expired-1"));
    const onPaired = vi.fn();
    const pairing = new PairingController({ pairSession }, onPaired);
    pairing.open();
    const input = document.querySelector<HTMLInputElement>('input[aria-label="配对码"]')!;
    input.value = "abc";
    document.querySelector<HTMLFormElement>("form")!.requestSubmit();
    expect(pairSession).not.toHaveBeenCalled();
    expect(document.querySelector(".command-feedback")?.textContent).toContain("8 位数字");
    input.value = "00000000";
    document.querySelector<HTMLFormElement>("form")!.requestSubmit();
    await vi.waitFor(() => expect(document.querySelector(".error-state__code")?.textContent).toContain("PAIRING_WRONG"));
    expect(document.querySelector(".error-state__code")?.textContent).toContain("wrong-1");
    expect(document.querySelector("button[type='submit']")).not.toHaveProperty("disabled", true);
    input.value = "11111111";
    document.querySelector<HTMLFormElement>("form")!.requestSubmit();
    await vi.waitFor(() => expect(document.querySelector(".error-state__code")?.textContent).toContain("PAIRING_EXPIRED"));
    expect(document.querySelectorAll(".drawer")).toHaveLength(1);
    expect(pairSession).toHaveBeenCalledTimes(2);
    expect(onPaired).not.toHaveBeenCalled();
    expect(pairing.getCsrfToken()).toBeUndefined();
  });

  it("discards a late response after dismissal and allows reopening", async () => {
    shell();
    let resolvePair!: (value: { data: { paired: boolean; csrf_token: string } }) => void;
    const pairSession = vi.fn(() => new Promise<{ data: { paired: boolean; csrf_token: string } }>((resolve) => { resolvePair = resolve; }));
    const onPaired = vi.fn();
    const pairing = new PairingController({ pairSession }, onPaired);
    pairing.open();
    document.querySelector<HTMLInputElement>('input[aria-label="配对码"]')!.value = "82736451";
    document.querySelector<HTMLFormElement>("form")!.requestSubmit();
    expect(document.querySelector("button[type='submit']")).toHaveProperty("disabled", true);
    document.querySelector<HTMLButtonElement>(".drawer__header button")!.click();
    resolvePair({ data: { paired: true, csrf_token: "late-token" } });
    await Promise.resolve();
    await Promise.resolve();
    expect(onPaired).not.toHaveBeenCalled();
    expect(pairing.getCsrfToken()).toBeUndefined();
    pairing.open();
    expect(document.querySelectorAll(".drawer")).toHaveLength(1);
    expect(document.querySelector<HTMLInputElement>('input[aria-label="配对码"]')!.value).toBe("");
  });

  it("rejects an invalid pair response without storing a token or resuming", async () => {
    shell();
    const onPaired = vi.fn();
    const pairing = new PairingController({ pairSession: async () => ({ data: { paired: false, csrf_token: "" } }) }, onPaired);
    pairing.open();
    document.querySelector<HTMLInputElement>('input[aria-label="配对码"]')!.value = "82736451";
    document.querySelector<HTMLFormElement>("form")!.requestSubmit();
    await vi.waitFor(() => expect(document.querySelector(".error-state__code")?.textContent).toContain("INVALID_RESPONSE"));
    expect(pairing.getCsrfToken()).toBeUndefined();
    expect(onPaired).not.toHaveBeenCalled();
    expect(document.querySelector(".drawer")).not.toBeNull();
  });

  it("clears the memory token when session recovery is requested and localizes the dialog", async () => {
    shell();
    const pairing = new PairingController({ pairSession: async () => ({ data: { paired: true, csrf_token: "old-test-token" } }) }, vi.fn());
    pairing.open();
    document.querySelector<HTMLInputElement>('input[aria-label="配对码"]')!.value = "82736451";
    document.querySelector<HTMLFormElement>("form")!.requestSubmit();
    await vi.waitFor(() => expect(pairing.getCsrfToken()).toBe("old-test-token"));
    expect(document.querySelector(".drawer")).toBeNull();
    pairing.request();
    expect(pairing.getCsrfToken()).toBeUndefined();
    translateLocale("en");
    expect(document.querySelector(".drawer__title")?.textContent).toBe("Pair this device");
    expect(document.querySelector('input[aria-label="Pairing code"]')).not.toBeNull();
    expect(document.querySelector("button[type='submit']")?.textContent).toBe("Pair and continue");
  });

  it("makes CSRF available to the resume callback before closing the dialog", async () => {
    shell();
    let pairing!: PairingController;
    const onPaired = vi.fn(() => { expect(pairing.getCsrfToken()).toBe("resume-token"); });
    pairing = new PairingController({ pairSession: async () => ({ data: { paired: true, csrf_token: "resume-token" } }) }, onPaired);
    pairing.open();
    document.querySelector<HTMLInputElement>('input[aria-label="配对码"]')!.value = "82736451";
    document.querySelector<HTMLFormElement>("form")!.requestSubmit();
    await vi.waitFor(() => expect(onPaired).toHaveBeenCalledOnce());
    expect(pairing.getCsrfToken()).toBe("resume-token");
    expect(document.querySelector(".drawer")).toBeNull();
  });
});
