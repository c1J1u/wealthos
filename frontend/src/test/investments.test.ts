import { describe, expect, it } from "vitest";
import { instrumentIndex, positionInstrument } from "../domain/investments";

describe("instrument mapping", () => {
  it("joins by stable instrument id, never by ticker text", () => {
    const instruments = instrumentIndex([{ instrument_id: "i-1", ticker: "600519", name: "贵州茅台", asset_class: "EQUITY", currency: "CNY" }]);
    expect(positionInstrument({ instrument_id: "i-1" } as never, instruments)?.asset_class).toBe("EQUITY");
    expect(positionInstrument({ instrument_id: "i-unknown" } as never, instruments)).toBeUndefined();
  });
});
