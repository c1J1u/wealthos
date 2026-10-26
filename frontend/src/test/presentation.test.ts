import { describe, expect, it } from "vitest";
import { transactionAmountTone } from "../domain/presentation";

describe("transaction amount presentation", () => {
  it("uses server flow effects instead of guessing signs from transaction type", () => {
    expect(transactionAmountTone({ entries: [{ flow_effect: "CONSUMPTION" }] } as never)).toBe("expense");
    expect(transactionAmountTone({ entries: [{ flow_effect: "INCOME_SALARY" }] } as never)).toBe("income");
    expect(transactionAmountTone({ entries: [{ flow_effect: "TRANSFER_INTERNAL" }] } as never)).toBe("neutral");
    expect(transactionAmountTone({ entries: [{ flow_effect: "ASSET_EXCHANGE" }] } as never)).toBe("neutral");
    expect(transactionAmountTone({ entries: [{ flow_effect: "REFUND_REVERSAL" }] } as never)).toBe("income");
    expect(transactionAmountTone({} as never)).toBe("unknown");
    expect(transactionAmountTone({ entries: [{ flow_effect: "CONSUMPTION" }, { flow_effect: "TRANSFER_INTERNAL" }] } as never)).toBe("unknown");
    expect(transactionAmountTone({ entries: [{ flow_effect: "PROVIDENT_FUND_EMPLOYEE" }] } as never)).toBe("unknown");
  });

  it("prefers the versioned server display direction without requiring list entries", () => {
    expect(transactionAmountTone({ display_effect: "OUTFLOW", entries: [] } as never)).toBe("expense");
    expect(transactionAmountTone({ display_effect: "INFLOW", entries: [] } as never)).toBe("income");
    expect(transactionAmountTone({ display_effect: "NEUTRAL", entries: [] } as never)).toBe("neutral");
  });
});
