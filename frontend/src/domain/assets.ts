import type { AssetValuation } from "@wealthos/api-client";
import { isDate } from "./period";

export function valuationContractErrors(assetId: string, valuations: Pick<AssetValuation, "asset_id" | "as_of" | "market_value_cents" | "cost_basis_cents" | "unrealized_gain_loss_cents">[]): string[] {
  const errors = new Set<string>();
  for (const valuation of valuations) {
    if (valuation.asset_id !== assetId) errors.add("资产归属");
    if (!isDate(valuation.as_of)) errors.add("估值日期");
    for (const value of [valuation.market_value_cents, valuation.cost_basis_cents, valuation.unrealized_gain_loss_cents]) {
      if (value != null && !Number.isSafeInteger(value)) errors.add("估值金额");
    }
  }
  return [...errors];
}
