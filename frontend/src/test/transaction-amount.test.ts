// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { transactionAmountLabel } from "../components/transaction-amount";

describe("transaction amount label", () => {
  it("keeps a known amount unsigned when its direction is unavailable", () => {
    const node = transactionAmountLabel({ amount_cents: 18650, currency: "CNY", entries: [] } as never);
    expect(node.textContent).toBe("¥186.50");
    expect(node.getAttribute("aria-label")).toContain("方向待服务端提供");
    expect(node.className).toContain("cell-money--unknown");
  });

  it("uses a server-provided effect to distinguish income from a transfer", () => {
    expect(transactionAmountLabel({ amount_cents: 100, currency: "CNY", entries: [{ flow_effect: "INCOME_OTHER" }] } as never).textContent).toBe("+¥1.00");
    expect(transactionAmountLabel({ amount_cents: 100, currency: "CNY", entries: [{ flow_effect: "TRANSFER_INTERNAL" }] } as never).textContent).toBe("¥1.00");
  });

  it("exposes one visual flow label rather than duplicating the amount suffix", () => {
    const expense = transactionAmountLabel({ amount_cents: 100, currency: "CNY", entries: [{ flow_effect: "CONSUMPTION" }] } as never);
    expect(expense.textContent).toBe("−¥1.00");
    expect(expense.dataset.flowLabel).toBe("流出");
    expect(expense.getAttribute("aria-label")).toBe("流出 −¥1.00");
    const neutral = transactionAmountLabel({ amount_cents: 100, currency: "CNY", entries: [{ flow_effect: "TRANSFER_INTERNAL" }] } as never);
    expect(neutral.dataset.flowLabel).toBe("中性");
  });
});
